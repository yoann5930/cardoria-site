import test from "node:test";
import assert from "node:assert/strict";
import {
  __resetLiveStoreForTests,
  __setLiveStoreForTests,
  createLiveSession,
  getLiveSession,
  promoteDueScheduledLiveSessions,
  updateLiveSession
} from "../lib/live/sessions.js";

const admin={role:"admin",id:"admin-test",email:"admin@cardoria.invalid"};

test("scheduled Live validates date/time and stores canonical ISO",()=>{
  __setLiveStoreForTests({sessions:[],checkouts:[],adminAccess:[]});
  try{
    assert.throws(()=>createLiveSession({title:"Past",ownerRole:"admin",ownerId:"cardoria",scheduledAt:"2020-01-01T12:00:00Z",actor:admin}),{code:"LIVE_SCHEDULE_PAST"});
    assert.throws(()=>createLiveSession({title:"Bad",ownerRole:"admin",ownerId:"cardoria",scheduledAt:"not-a-date",actor:admin}),{code:"LIVE_SCHEDULE_INVALID"});
    const session=createLiveSession({title:"Future",ownerRole:"admin",ownerId:"cardoria",scheduledAt:"2099-06-15T14:30:00+02:00",actor:admin});
    assert.equal(session.status,"scheduled");
    assert.equal(session.scheduledAt,"2099-06-15T12:30:00.000Z");
  }finally{__resetLiveStoreForTests();}
});

test("editing schedule keeps draft/scheduled state coherent",()=>{
  __setLiveStoreForTests({sessions:[],checkouts:[],adminAccess:[]});
  try{
    const session=createLiveSession({title:"Draft",ownerRole:"admin",ownerId:"cardoria",actor:admin});
    assert.equal(session.status,"draft");
    const scheduled=updateLiveSession(session.id,{scheduledAt:"2099-07-01T18:00:00Z"},admin,{adminOverride:true});
    assert.equal(scheduled.status,"scheduled");
    const draft=updateLiveSession(session.id,{scheduledAt:""},admin,{adminOverride:true});
    assert.equal(draft.status,"draft");
    assert.equal(draft.scheduledAt,"");
  }finally{__resetLiveStoreForTests();}
});

test("due scheduled Live auto-promotes exactly once while future and blocked seller stay scheduled",()=>{
  const now=Date.parse("2026-09-22T20:00:00Z");
  const store={sessions:[
    {id:"LIVE-DUE",title:"Due",ownerRole:"admin",ownerId:"cardoria",status:"scheduled",scheduledAt:"2026-09-22T19:59:00Z",startedAt:"",endedAt:"",products:[],createdAt:"2026-09-22T18:00:00Z",updatedAt:"2026-09-22T18:00:00Z"},
    {id:"LIVE-FUTURE",title:"Future",ownerRole:"admin",ownerId:"cardoria",status:"scheduled",scheduledAt:"2026-09-22T20:30:00Z",startedAt:"",endedAt:"",products:[],createdAt:"2026-09-22T18:00:00Z",updatedAt:"2026-09-22T18:00:00Z"},
    {id:"LIVE-SELLER",title:"Seller",ownerRole:"seller",ownerId:"SELLER-1",status:"scheduled",scheduledAt:"2026-09-22T19:59:00Z",startedAt:"",endedAt:"",products:[],createdAt:"2026-09-22T18:00:00Z",updatedAt:"2026-09-22T18:00:00Z"}
  ],checkouts:[],adminAccess:[]};
  __setLiveStoreForTests(store);
  try{
    const result=promoteDueScheduledLiveSessions({now,canStart:(session)=>session.ownerRole!=="seller"});
    assert.deepEqual(result.promoted,["LIVE-DUE"]);
    assert.deepEqual(result.blocked,["LIVE-SELLER"]);
    assert.equal(getLiveSession("LIVE-DUE").status,"live");
    assert.equal(getLiveSession("LIVE-DUE").startedAt,"2026-09-22T20:00:00.000Z");
    assert.equal(getLiveSession("LIVE-FUTURE").status,"scheduled");
    assert.equal(getLiveSession("LIVE-SELLER").status,"scheduled");
    const replay=promoteDueScheduledLiveSessions({now:now+60_000,canStart:()=>true});
    assert.deepEqual(replay.promoted,["LIVE-SELLER"]);
    assert.equal(getLiveSession("LIVE-DUE").startedAt,"2026-09-22T20:00:00.000Z");
  }finally{__resetLiveStoreForTests();}
});
