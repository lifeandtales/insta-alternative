import test from 'node:test';
import assert from 'node:assert/strict';
import { changeVerifiedPassword } from '../src/features/account-password.js';

test('changing the current account password requires a verified session and matching valid passwords', async () => {
    let updates=0;
    const client={auth:{getUser:async()=>({data:{user:{id:'owner'}}}),updateUser:async value=>{updates++;assert.equal(value.password,'new-password');return {};}}};
    await assert.rejects(changeVerifiedPassword(client,'short','short'),/at least 8/);
    await assert.rejects(changeVerifiedPassword(client,'new-password','different'),/do not match/);
    assert.equal(updates,0);
    await assert.rejects(changeVerifiedPassword({auth:{...client.auth,getUser:async()=>({error:new Error('expired')})}},'new-password','new-password'),/session expired/);
    assert.equal(updates,0);
    await changeVerifiedPassword(client,'new-password','new-password');
    assert.equal(updates,1);
});

test('password update failures are reported and do not sign out the usable admin session', async () => {
    let signedOut=false;
    const client={auth:{getUser:async()=>({data:{user:{id:'owner'}}}),updateUser:async()=>({error:new Error('recent verification required')}),signOut:async()=>{signedOut=true;}}};
    await assert.rejects(changeVerifiedPassword(client,'new-password','new-password'),/recent verification/);
    assert.equal(signedOut,false);
});
