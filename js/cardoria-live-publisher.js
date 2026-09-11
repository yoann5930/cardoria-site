(function (global) {
  "use strict";
  var ICE = { iceServers: [{ urls: "stun:stun.cloudflare.com:3478" }, { urls: "stun:stun.l.google.com:19302" }], bundlePolicy: "max-bundle" };
  function waitIce(pc) { if (pc.iceGatheringState === "complete") return Promise.resolve(); return new Promise(function (resolve) { var done=false; function finish(){if(!done){done=true;resolve();}} pc.addEventListener("icegatheringstatechange",function(){if(pc.iceGatheringState==="complete")finish();}); setTimeout(finish,3000); }); }
  async function devices() { if (!navigator.mediaDevices || !navigator.mediaDevices.enumerateDevices) return { cameras: [], microphones: [] }; var list=await navigator.mediaDevices.enumerateDevices(); return { cameras:list.filter(function(d){return d.kind==="videoinput";}), microphones:list.filter(function(d){return d.kind==="audioinput";}) }; }
  async function post(path,body,headers){var response=await fetch(path,{method:"POST",headers:headers,body:JSON.stringify(body),cache:"no-store"});var payload=await response.json().catch(function(){return{};});if(!response.ok||payload.ok===false)throw new Error(payload.error||"Publication WebRTC impossible.");return payload;}
  async function publish(opts) {
    opts=opts||{}; var liveId=String(opts.liveId||""),token=String(opts.token||""),pairToken=String(opts.pairToken||""),sourceId=String(opts.sourceId||(pairToken?"secondary":"primary")),preview=opts.preview;
    if(!liveId&&!pairToken)throw new Error("Identifiant Live manquant."); if(!navigator.mediaDevices||!navigator.mediaDevices.getUserMedia)throw new Error("Ce navigateur ne peut pas publier de caméra/micro.");
    var headers={Accept:"application/json","Content-Type":"application/json"}; if(token)headers.Authorization="Bearer "+token;
    var stream;
    if(global.CardoriaLiveMedia&&CardoriaLiveMedia.getUserMediaStream){
      stream=await CardoriaLiveMedia.getUserMediaStream({cameraId:opts.cameraId,microphoneId:opts.microphoneId,audio:opts.audio,isMobile:opts.isMobile});
    }else{
      var video=opts.cameraId?{deviceId:{exact:opts.cameraId}}:true;
      var audio=opts.microphoneId?{deviceId:{exact:opts.microphoneId}}:(opts.audio===false?false:true);
      stream=await navigator.mediaDevices.getUserMedia({video:video,audio:audio});
    }
    if(preview){preview.srcObject=stream;preview.muted=true;preview.playsInline=true;preview.play().catch(function(){});}
    var bootstrap=new RTCPeerConnection(ICE); stream.getTracks().forEach(function(track){bootstrap.addTrack(track,stream);}); var offer=await bootstrap.createOffer(); await bootstrap.setLocalDescription(offer); await waitIce(bootstrap); var local=bootstrap.localDescription||offer;
    var tracks=bootstrap.getTransceivers().filter(function(item){return item.sender&&item.sender.track;}).map(function(item){return{mid:item.mid,trackName:sourceId+"-"+(item.sender.track.kind==="video"?"camera":"microphone"),kind:item.sender.track.kind};});
    var response=await fetch("/api/live/webrtc/publisher/start",{method:"POST",headers:headers,body:JSON.stringify({liveSessionId:liveId,pairToken:pairToken||undefined,sourceId:sourceId,offer:{type:"offer",sdp:local.sdp||""},tracks:tracks})}); var payload=await response.json().catch(function(){return{};});
    if(!response.ok||payload.ok===false){stream.getTracks().forEach(function(track){track.stop();});bootstrap.close();throw new Error(payload.error||"Publication WebRTC impossible.");}
    liveId=payload.liveId||liveId; sourceId=payload.sourceId||sourceId;
    if(payload.mode!=="p2p"){if(payload.answer)await bootstrap.setRemoteDescription(payload.answer);return{liveId:liveId,sourceId:sourceId,stream:stream,stop:async function(){stream.getTracks().forEach(function(track){track.stop();});bootstrap.close();if(preview)preview.srcObject=null;if(!pairToken){try{await fetch("/api/live/webrtc/publisher/stop",{method:"POST",headers:headers,body:JSON.stringify({liveSessionId:liveId,sourceId:sourceId}),keepalive:true});}catch(e){}}}};}
    bootstrap.close(); var publisherKey=payload.publisherKey, peers=new Map(), stopped=false;
    async function handleOffer(item){if(stopped||peers.has(item.viewerId))return;var pc=new RTCPeerConnection(ICE);peers.set(item.viewerId,pc);stream.getTracks().forEach(function(track){pc.addTrack(track,stream);});try{await pc.setRemoteDescription(item.offer);var answer=await pc.createAnswer();await pc.setLocalDescription(answer);await waitIce(pc);var desc=pc.localDescription||answer;await post("/api/live/webrtc/publisher/answer",{liveSessionId:liveId,sourceId:sourceId,publisherKey:publisherKey,viewerId:item.viewerId,answer:{type:"answer",sdp:desc.sdp||""}},headers);}catch(e){pc.close();peers.delete(item.viewerId);}}
    async function poll(){if(stopped)return;try{var data=await post("/api/live/webrtc/publisher/offers",{liveSessionId:liveId,sourceId:sourceId,publisherKey:publisherKey},headers);(data.offers||[]).forEach(function(item){void handleOffer(item);});}catch(e){}}
    var timer=setInterval(poll,1000);void poll();
    return{liveId:liveId,sourceId:sourceId,stream:stream,mode:"p2p",stop:async function(){stopped=true;clearInterval(timer);peers.forEach(function(pc){pc.close();});peers.clear();stream.getTracks().forEach(function(track){track.stop();});if(preview)preview.srcObject=null;if(!pairToken){try{await fetch("/api/live/webrtc/publisher/stop",{method:"POST",headers:headers,body:JSON.stringify({liveSessionId:liveId,sourceId:sourceId}),keepalive:true});}catch(e){}}}};
  }
  global.CardoriaLivePublisher={publish:publish,devices:devices};
})(window);
