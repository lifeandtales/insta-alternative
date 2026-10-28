import test from 'node:test';
import assert from 'node:assert/strict';
import {loadApp} from './helpers/app-harness.js';

test('caption autocomplete uses the token at the caret and ranks followed people before global matches',async()=>{
    const app=await loadApp(),{state}=app.exportsOf('src/core/state.js'),suggest=app.exportsOf('src/features/caption-suggestions.js');
    state.accountDirectory=[{name:'A global',handle:'@alex_public'},{name:'B private',handle:'@alex_private',isPrivate:true},{name:'Z followed',handle:'@alex_friend'}];state.followedAccountHandles=new Set(['@alex_friend']);
    assert.equal(suggest.getCaptionSuggestionContext('Hello there'),null);assert.equal(suggest.getCaptionSuggestionContext('mail@alex'),null);
    const context=suggest.getCaptionSuggestionContext('Hello @alex!');assert.equal(context,null);
    const atCaret=suggest.getCaptionSuggestionContext('Hello @alex!',11);
    assert.deepEqual(Array.from(suggest.getCaptionSuggestionItems(atCaret),item=>item.value),['@alex_friend','@alex_public','@alex_private']);
    const completion=suggest.completeCaptionSuggestion('Hello @alex!',atCaret,'@alex_friend');assert.equal(completion.text,'Hello @alex_friend!');
    assert.equal(suggest.completeCaptionSuggestion('Hi @al',suggest.getCaptionSuggestionContext('Hi @al'),'@alex_friend').text,'Hi @alex_friend ');
});

test('hashtag suggestions exclude private content and support a new hashtag; result pages remain newest first',async()=>{
    const app=await loadApp(),{state}=app.exportsOf('src/core/state.js'),{posts}=app.exportsOf('src/data/sample-data.js'),suggest=app.exportsOf('src/features/caption-suggestions.js'),{getHashtagResults}=app.exportsOf('src/features/explore.js');
    posts.unshift({...posts[0],id:9911,caption:'#publicdemo',public:true,createdAt:100},{...posts[0],id:9912,caption:'#publicdemo',public:true,createdAt:200},{...posts[0],id:9913,caption:'#secretdemo',public:false,createdAt:300});
    const items=suggest.getCaptionSuggestionItems(suggest.getCaptionSuggestionContext('Hello #public'));
    assert.ok(items.some(item=>item.value==='#publicdemo'));assert.ok(!suggest.getCaptionSuggestionItems(suggest.getCaptionSuggestionContext('#')).some(item=>item.value==='#secretdemo'));
    assert.equal(suggest.getCaptionSuggestionItems(suggest.getCaptionSuggestionContext('#brandnewunique'))[0].value,'#brandnewunique');
    assert.deepEqual(Array.from(getHashtagResults('publicdemo').posts,item=>item.id),[9912,9911]);
    state.accountDirectory.find(account=>account.handle===posts[0].handle).isPrivate=true;
    assert.equal(getHashtagResults('publicdemo').posts.length,0);
});

test('caption hashtags are clickable and close confirmation can be dismissed or discard the edit',async()=>{
    const app=await loadApp(),{renderCaption}=app.exportsOf('src/components/caption.js'),{state}=app.exportsOf('src/core/state.js'),create=app.exportsOf('src/features/create.js');
    assert.match(renderCaption('A #newtag'),/data-search-kind="hashtag" data-search-value="newtag"/);
    create.openCreateUpload('post');state.createMediaItems=[{type:'image',url:'fixture.jpg'}];create.startCreateEditing();create.closeCreateUpload();
    assert.equal(app.element('.create-exit-dialog').hidden,false);assert.equal(app.element('.create-upload-backdrop').hidden,false);
    create.dismissCreateExit();assert.equal(app.element('.create-exit-dialog').hidden,true);assert.equal(state.createMediaItems.length,1);
    create.closeCreateUpload();create.closeCreateUpload(true);assert.equal(app.element('.create-upload-backdrop').hidden,true);assert.equal(state.createMediaItems.length,0);
});
