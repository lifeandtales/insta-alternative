import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { stripTypeScriptTypes } from 'node:module';
import vm from 'node:vm';

const target='10000000-0000-0000-0000-000000000001';
const requestId='20000000-0000-0000-0000-000000000002';
async function endpoint({admin=true,protectedAccount=false,cleanupFails=false}={}) {
    let handler;
    const calls=[];
    const caller={auth:{getUser:async()=>({data:{user:{id:'signed-in-admin'}}})},rpc:async(name)=>{
        if(!admin)return {error:{code:'42501'}};
        if(name==='admin_user_details')return {data:{account:{id:target,username:'member',is_admin:protectedAccount}}};
        if(name==='admin_deletion_requests')return {data:[{id:requestId,user_id:target,status:'pending'}]};
        calls.push(name);
        return {data:name==='admin_start_account_deletion'?requestId:{status:'processing',user_id:target}};
    }};
    const server={auth:{admin:{updateUserById:async()=>{calls.push('ban');return {};},deleteUser:async()=>{calls.push('delete-auth');return {};}}},
        rpc:async()=>({data:{supabase:[{bucket:'post-images',path:target+'/photo'}],s3:[{category:'post-photos',key:'media/'+target+'/object'}]}}),
        storage:{from:()=>({remove:async()=>{calls.push('remove-supabase');return cleanupFails?{error:new Error('Storage unavailable')}:{data:[]};}})},
        from:()=>{const q={update(value){calls.push(value.status==='completed'?'completed':'cleanup-error');return this;},delete(){return this;},eq(){return this;},then(resolve){resolve({data:[]});}};return q;},
    };
    const context={Request,Response,console,createClient:(url,key)=>key==='service'?server:caller,
        S3Client:class {async send(){calls.push('remove-s3');return {};}},
        DeleteObjectsCommand:class {constructor(input){this.input=input;}},
        Deno:{env:{get:name=>({SUPABASE_URL:'https://example.test',SUPABASE_ANON_KEY:'public',SUPABASE_SERVICE_ROLE_KEY:'service',REEL_S3_ACCESS_KEY_ID:'test',REEL_S3_SECRET_ACCESS_KEY:'test'}[name])},serve:fn=>handler=fn}};
    const code=(await readFile(new URL('../supabase/functions/admin-users/index.ts',import.meta.url),'utf8')).replace(/^import .*;\n/gm,'');
    vm.runInNewContext(stripTypeScriptTypes(code,{mode:'transform'}),context);
    return {calls,async send(body){const response=await handler(new Request('https://example.test',{method:'POST',headers:{Authorization:'Bearer test','Content-Type':'application/json'},body:JSON.stringify(body)}));return {status:response.status,data:await response.json()};}};
}

test('normal users cannot execute deletion; protected admins and missing typed confirmation stop before cleanup',async()=>{
    for(const [options,confirmation,status]of [[{admin:false},'member',403],[{protectedAccount:true},'member',403],[{},'',400]]){
        const api=await endpoint(options);
        assert.equal((await api.send({action:'delete',target,confirmation})).status,status);
        assert.equal(api.calls.includes('delete-auth'),false);
        assert.equal(api.calls.includes('ban'),false);
    }
});

test('admin approval cleans active Supabase and S3 objects before deleting Auth and completing the audit request',async()=>{
    const api=await endpoint();
    assert.equal((await api.send({action:'approve_deletion',request_id:requestId,confirmation:'member'})).status,200);
    assert.deepEqual(api.calls.slice(0,6),['admin_decide_account_deletion','ban','remove-supabase','remove-s3','delete-auth','completed']);
});

test('failed cleanup leaves the request retryable and never reports the Auth account deleted',async()=>{
    const api=await endpoint({cleanupFails:true});
    const result=await api.send({action:'delete',target,confirmation:'member'});
    assert.equal(result.status,409);
    assert.match(result.data.message,/retry deletion/);
    assert.equal(api.calls.includes('delete-auth'),false);
    assert.equal(api.calls.includes('cleanup-error'),true);
});

test('rejecting a deletion request performs no storage or Auth deletion',async()=>{
    const api=await endpoint();
    assert.equal((await api.send({action:'reject_deletion',request_id:requestId,note:'Needs review'})).status,200);
    assert.equal(api.calls.includes('delete-auth'),false);
    assert.equal(api.calls.includes('ban'),false);
});
