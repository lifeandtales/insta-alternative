import test from 'node:test';
import assert from 'node:assert/strict';
import {loadApp} from './helpers/app-harness.js';

test('Home exposes Delete only for the current user posts and keeps profile editing controls',async()=>{
    const app=await loadApp(),{currentUser,posts}=app.exportsOf('src/data/sample-data.js'),{renderPostCards}=app.exportsOf('src/components/post-card.js');
    renderPostCards([{...posts[0],id:99910,handle:currentUser.handle,user:currentUser.name}]);assert.match(app.element('#feed').innerHTML,/data-post-option="delete"/);
    renderPostCards([posts.find(post=>post.handle!==currentUser.handle)]);assert.doesNotMatch(app.element('#feed').innerHTML,/data-post-option="delete"/);
});

test('Home deletion removes only the owned post and does not open a profile viewer',async()=>{
    const app=await loadApp(),{state}=app.exportsOf('src/core/state.js'),{currentUser,posts}=app.exportsOf('src/data/sample-data.js'),profile=app.exportsOf('src/features/profile.js');
    state.currentView='home';state.profileHandle='@aribloom';const own={...posts[0],id:99911,handle:currentUser.handle,user:currentUser.name};posts.unshift(own);
    assert.equal(profile.deleteProfileMedia('post',own.id,{fromHome:true}),true);assert.equal(posts.some(post=>post.id===own.id),false);assert.equal(state.currentView,'home');
    const other=posts.find(post=>post.handle!==currentUser.handle);assert.equal(profile.deleteProfileMedia('post',other.id,{fromHome:true}),false);assert.ok(posts.includes(other));
});

test('moving a published post to draft preserves its media edits, caption, tags and cover selection',async()=>{
    const app=await loadApp(),{draftFromPublishedMedia}=app.exportsOf('src/features/profile.js');
    const entity={id:77,mediaItems:[{type:'image',url:'one.jpg',text:'Keep',filter:'warm',ratio:'4/5'},{type:'video',url:'two.mp4',originalAudioMuted:true}],coverIndex:1,caption:'Hello @aribloom #idea',location:'Delhi',taggedUsers:['@aribloom'],cover:'cover.jpg'};
    const draft=draftFromPublishedMedia('post',entity,123);
    assert.equal(draft.items.length,2);assert.equal(draft.items[0].text,'Keep');assert.equal(draft.items[1].originalAudioMuted,true);assert.equal(draft.coverIndex,1);assert.equal(draft.tags,'@aribloom');assert.equal(draft.caption,entity.caption);assert.equal(draft.location,'Delhi');assert.equal(draft.savedAt,123);
    entity.mediaItems[0].text='Changed';assert.equal(draft.items[0].text,'Keep');
});

test('failed draft storage leaves the published post intact',async()=>{
    const app=await loadApp(),{state}=app.exportsOf('src/core/state.js'),{posts,currentUser}=app.exportsOf('src/data/sample-data.js'),{movePublishedMediaToDraft}=app.exportsOf('src/features/profile.js');
    state.currentView='home';const post={...posts[0],id:99912,handle:currentUser.handle};posts.unshift(post);const count=state.draftItems.length;
    assert.equal(await movePublishedMediaToDraft('post',post.id,{fromHome:true}),false);assert.ok(posts.includes(post));assert.equal(state.draftItems.length,count);
});

test('post and reel draft options are hidden while stored drafts remain intact',async()=>{
    const app=await loadApp(),{state}=app.exportsOf('src/core/state.js'),{currentUser,posts}=app.exportsOf('src/data/sample-data.js'),profile=app.exportsOf('src/features/profile.js');
    state.profileHandle=currentUser.handle;state.activeProfileSection='drafts';state.draftItems=[{id:'saved-draft',savedAt:Date.now(),type:'post',items:[{type:'image',url:'saved.jpg'}]}];
    profile.renderProfile();assert.doesNotMatch(app.element('#profile-view').innerHTML,/profile-drafts-button|data-profile-content="drafts"/);assert.equal(state.draftItems.length,1);assert.equal(state.activeProfileSection,'posts');
    profile.openMediaDeleteConfirmation('post',posts.find(post=>post.handle===currentUser.handle));assert.doesNotMatch(app.element('#media-delete-message').textContent,/draft/i);
});
