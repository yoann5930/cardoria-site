(function (global) {
  "use strict";
  var ICE = { iceServers: [{ urls: "stun:stun.cloudflare.com:3478" }, { urls: "stun:stun.l.google.com:19302" }], bundlePolicy: "max-bundle" };
  function waitIce(pc) { if (pc.iceGatheringState === "complete") return Promise.resolve(); return new Promise(function (resolve) { var done=false; function finish(){if(!done){done=true;resolve();}} pc.addEventListener("icegatheringstatechange",function(){if(pc.iceGatheringState==="complete")finish();}); setTimeout(finish,3000); }); }
  function usedCameraId(stream, fallback) { try { var track=stream&&stream.getVideoTracks&&stream.getVideoTracks()[0]; var settings=track&&track.getSettings?track.getSettings():{}; return String(settings.deviceId||fallback||""); } catch (e) { return String(fallback||""); } }
  async function devices() { if (!navigator.mediaDevices || !navigator.mediaDevices.enumerateDevices) return { cameras: [], microphones: [] }; var list=await navigator.mediaDevices.enumerateDevices(); return { cameras:list.filter(function(d){return d.kind==="videoinput";}), microphones:list.filter(function(d){return d.kind==="audioinput";}) }; }
  async function post(path,body,headers){var response=await fetch(path,{method:"POST",headers:headers,body:JSON.stringify(body),cache:"no-store"});var payload=await response.json().catch(function(){return{};});if(!response.ok||payload.ok===false){var err=new Error(payload.error||"Publication WebRTC impossible.");err.status=response.status;throw err;}return payload;}
  function waitForPreview(preview,stream,timeoutMs){
    if(!preview)return Promise.resolve(true);
    preview.srcObject=stream;preview.muted=true;preview.playsInline=true;
    return new Promise(function(resolve,reject){var done=false,timer=null;function finish(ok,error){if(done)return;done=true;if(timer)clearTimeout(timer);preview.removeEventListener("loadeddata",ready);preview.removeEventListener("playing",ready);if(ok)resolve(true);else reject(error||new Error("La caméra ne fournit aucune image."));}function ready(){if(preview.videoWidth>0&&preview.videoHeight>0){preview.play().catch(function(){});finish(true);}}preview.addEventListener("loadeddata",ready);preview.addEventListener("playing",ready);preview.play().catch(function(){});timer=setTimeout(function(){var track=stream.getVideoTracks&&stream.getVideoTracks()[0];var reason=track&&track.muted?"La caméra est active mais son flux vidéo est muet. Essayez un autre port USB ou relancez Caméra 2.":"La caméra est ouverte mais aucune image vidéo n'est reçue. Essayez un autre port USB ou relancez la caméra.";finish(false,new Error(reason));},timeoutMs||5000);ready();});
  }
  async function publish(opts) {
    opts=opts||{}; var liveId=String(opts.liveId||""),token=String(opts.token||""),grantToken=String(opts.grantToken||""),pairToken=String(opts.pairToken||""),sourceId=String(opts.sourceId||(pairToken?"secondary":"primary")),preview=opts.preview;
    if(!liveId&&!pairToken)throw new Error("Identifiant Live manquant."); if(!navigator.mediaDevices||!navigator.mediaDevices.getUserMedia)throw new Error("Ce navigateur ne peut pas publier de caméra/micro.");
    var headers={Accept:"application/json","Content-Type":"application/json"}; if(token)headers.Authorization="Bearer "+token; if(grantToken)headers["x-live-admin-grant"]=grantToken;
    var stream,videoProfile=sourceId==="secondary"&&!pairToken?"secondary":"primary";
    if(global.CardoriaLiveMedia&&CardoriaLiveMedia.getUserMediaStream){
      stream=await CardoriaLiveMedia.getUserMediaStream({cameraId:opts.cameraId,microphoneId:opts.microphoneId,audio:opts.audio,isMobile:opts.isMobile,videoProfile:videoProfile});
    }else{
      var video=opts.cameraId?{deviceId:{exact:opts.cameraId}}:true;
      if(sourceId==="secondary"&&video!==true){video.width={ideal:640,max:1280};video.height={ideal:480,max:720};video.frameRate={ideal:24,max:30};}
      var audio=opts.microphoneId?{deviceId:{exact:opts.microphoneId}}:(opts.audio===false?false:true);
      stream=await navigator.mediaDevices.getUserMedia({video:video,audio:audio});
    }
    var videoTrack=stream.getVideoTracks&&stream.getVideoTracks()[0];
    if(!videoTrack){stream.getTracks().forEach(function(track){track.stop();});throw new Error("Aucun flux vidéo reçu depuis cette caméra.");}
    try{await waitForPreview(preview,stream,5000);}catch(previewError){stream.getTracks().forEach(function(track){track.stop();});if(preview)preview.srcObject=null;throw previewError;}
    var bootstrap=new RTCPeerConnection(ICE); stream.getTracks().forEach(function(track){bootstrap.addTrack(track,stream);}); var offer=await bootstrap.createOffer(); await bootstrap.setLocalDescription(offer); await waitIce(bootstrap); var local=bootstrap.localDescription||offer;
    var tracks=bootstrap.getTransceivers().filter(function(item){return item.sender&&item.sender.track;}).map(function(item){return{mid:item.mid,trackName:sourceId+"-"+(item.sender.track.kind==="video"?"camera":"microphone"),kind:item.sender.track.kind};});
    var response=await fetch("/api/live/webrtc/publisher/start",{method:"POST",headers:headers,body:JSON.stringify({liveSessionId:liveId,pairToken:pairToken||undefined,sourceId:sourceId,offer:{type:"offer",sdp:local.sdp||""},tracks:tracks})}); var payload=await response.json().catch(function(){return{};});
    if(!response.ok||payload.ok===false){stream.getTracks().forEach(function(track){track.stop();});bootstrap.close();if(preview)preview.srcObject=null;var startError=new Error(payload.error||"Publication WebRTC impossible.");startError.status=response.status;throw startError;}
    liveId=payload.liveId||liveId; sourceId=payload.sourceId||sourceId;
    if(payload.mode!=="p2p"){if(payload.answer)await bootstrap.setRemoteDescription(payload.answer);return{liveId:liveId,sourceId:sourceId,stream:stream,cameraId:usedCameraId(stream,opts.cameraId),stop:async function(){stream.getTracks().forEach(function(track){track.stop();});bootstrap.close();if(preview)preview.srcObject=null;if(!pairToken){try{await fetch("/api/live/webrtc/publisher/stop",{method:"POST",headers:headers,body:JSON.stringify({liveSessionId:liveId,sourceId:sourceId}),keepalive:true});}catch(e){}}}};}
    bootstrap.close(); var publisherKey=payload.publisherKey, peers=new Map(), stopped=false,pollDelay=6000,pollTimer=null,pollBusy=false;
    async function handleOffer(item){if(stopped||peers.has(item.viewerId))return;var pc=new RTCPeerConnection(ICE);peers.set(item.viewerId,pc);stream.getTracks().forEach(function(track){pc.addTrack(track,stream);});try{await pc.setRemoteDescription(item.offer);var answer=await pc.createAnswer();await pc.setLocalDescription(answer);await waitIce(pc);var desc=pc.localDescription||answer;await post("/api/live/webrtc/publisher/answer",{liveSessionId:liveId,sourceId:sourceId,publisherKey:publisherKey,viewerId:item.viewerId,answer:{type:"answer",sdp:desc.sdp||""}},headers);}catch(e){pc.close();peers.delete(item.viewerId);}}
    function schedulePoll(delay){if(stopped)return;if(pollTimer)clearTimeout(pollTimer);pollTimer=setTimeout(poll,delay==null?pollDelay:delay);}
    async function poll(){if(stopped||pollBusy)return;pollBusy=true;try{var data=await post("/api/live/webrtc/publisher/offers",{liveSessionId:liveId,sourceId:sourceId,publisherKey:publisherKey},headers);pollDelay=6000;(data.offers||[]).forEach(function(item){void handleOffer(item);});}catch(e){if(e&&e.status===429)pollDelay=Math.min(30000,Math.max(12000,pollDelay*2));else pollDelay=Math.min(15000,pollDelay+2000);}finally{pollBusy=false;schedulePoll(pollDelay);}}
    schedulePoll(1500);
    return{liveId:liveId,sourceId:sourceId,stream:stream,cameraId:usedCameraId(stream,opts.cameraId),mode:"p2p",stop:async function(){stopped=true;if(pollTimer)clearTimeout(pollTimer);peers.forEach(function(pc){pc.close();});peers.clear();stream.getTracks().forEach(function(track){track.stop();});if(preview)preview.srcObject=null;if(!pairToken){try{await fetch("/api/live/webrtc/publisher/stop",{method:"POST",headers:headers,body:JSON.stringify({liveSessionId:liveId,sourceId:sourceId}),keepalive:true});}catch(e){}}}};
  }
  global.CardoriaLivePublisher={publish:publish,devices:devices};
})(window);
