import { test } from "node:test";
import assert from "node:assert/strict";
import { combinedAccountUsage } from "../src/session-badge-state.mjs";
const account = (id, percentUsed) => ({ id, usage: { percentUsed } });

test("four unique account percentage pools sum to 25% /400%, without changing each account", () => {
  const accounts = [account("A", 10), account("B", 5), account("C", 6), account("D", 4)];
  const before = structuredClone(accounts);
  assert.deepEqual(combinedAccountUsage(accounts), { visible: true, count: 4, used: 25, capacity: 400, unknown: 0, unlimited: 0 });
  assert.deepEqual(accounts, before);
});

test("combined label is hidden with zero or one account", () => {
  for (const accounts of [undefined, null, [], [account("A", 20)], [{id:"A",usage:{unlimited:true}}]]) {
    assert.equal(combinedAccountUsage(accounts).visible, false);
  }
});

test("unknown, unavailable and nonfinite values remain unknown, not zero", () => {
  for (const missing of [{id:"B"}, {id:"B",usageError:"unavailable",usage:{percentUsed:10}},
    {id:"B",available:false,usage:{percentUsed:10}}, account("B",NaN), account("B",Infinity), account("B","10")]) {
    const result = combinedAccountUsage([account("A",10),missing]);
    assert.equal(result.visible,true); assert.equal(result.used,null); assert.equal(result.capacity,200); assert.equal(result.unknown,1);
  }
});

test("unlimited account cannot be presented as a finite billing capacity", () => {
  assert.deepEqual(combinedAccountUsage([account("A",10), {id:"B",usage:{unlimited:true,percentUsed:100}}]),
    {visible:true,count:2,used:null,capacity:null,unknown:0,unlimited:1});
});

test("sum rounds only at the end and clamps each percentage to its own pool", () => {
  assert.equal(combinedAccountUsage([account("A",0.4),account("B",0.4),account("C",0.4),account("D",0.4)]).used,2);
  assert.equal(combinedAccountUsage([account("A",140),account("B",-20)]).used,100);
  assert.equal(combinedAccountUsage([account("A",0),account("B",0)]).used,0);
  assert.equal(combinedAccountUsage([{id:"A",usage:{remaining:50,entitlement:100}},{id:"B",usage:{remaining:25,entitlement:100}}]).used,125);
});

test("duplicate and invalid ids do not invent extra capacity or overwrite first identity", () => {
  assert.deepEqual(combinedAccountUsage([account("A",10),account("A",90),account("B",5),account("",100),{usage:{percentUsed:100}}]),
    {visible:true,count:2,used:15,capacity:200,unknown:0,unlimited:0});
  assert.equal(combinedAccountUsage([account("A",10),account("A",20)]).visible,false);
});
