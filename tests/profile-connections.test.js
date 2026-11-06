import test from 'node:test';
import assert from 'node:assert/strict';
import { loadApp } from './helpers/app-harness.js';

test('connection lists enforce private account access and keep followers/following separate', async()=>{
 const app=await loadApp();const {state}=app.exportsOf('src/core/state.js');
 const {getProfileConnections}=app.exportsOf('src/features/profile.events.js');
 state.accountDirectory.push({handle:'@private-test',isPrivate:true,followers:['@aribloom'],following:['@noahvale']});
 assert.equal(getProfileConnections('@private-test','followers'),null);
 state.followedAccountHandles.add('@private-test');
 assert.deepEqual(Array.from(getProfileConnections('@private-test','followers'),p=>p.handle),['@aribloom']);
 assert.deepEqual(Array.from(getProfileConnections('@private-test','following'),p=>p.handle),['@noahvale']);
 state.blockedHandles.add('@private-test');assert.equal(getProfileConnections('@private-test','following'),null);
});
test('profile Back returns to the originating view',async()=>{
 const app=await loadApp();const {state}=app.exportsOf('src/core/state.js');
 const events=app.exportsOf('src/features/profile.events.js');
 app.exportsOf('src/core/navigation.js').setView('reels');
 const button={dataset:{profileHandle:'@aribloom'},closest:()=>null};
 events.handleAuthorClick({target:{closest:s=>s==='[data-profile-handle]'?button:null}});
 assert.equal(state.currentView,'profile');
 events.handleProfileSectionClick({target:{closest:s=>s==='[data-profile-back]'?{}:null}});
 assert.equal(state.currentView,'reels');
});
test('profile QR contains a real encoded matrix and profile links open the intended account',async()=>{
 const app=await loadApp();const {state}=app.exportsOf('src/core/state.js');
 const events=app.exportsOf('src/features/profile.events.js');
 const url=events.profileUrl('@aribloom');assert.match(url,/#profile-%40aribloom$/);
 const svg=events.profileQrSvg('@aribloom');assert.match(svg,/<svg/);assert.match(svg,/<path/);
 app.element('#welcome-screen').hidden=true;
 assert.equal(app.exportsOf('src/core/media-links.js').openMediaFromHash('#profile-%40aribloom'),true);
 assert.equal(state.profileHandle,'@aribloom');assert.equal(state.currentView,'profile');
 assert.equal(app.exportsOf('src/core/media-links.js').openMediaFromHash('#profile-%E0%A4%A'),false);
});
test('connection search matches names and usernames case-insensitively within the selected list',async()=>{
 const app=await loadApp();const {state}=app.exportsOf('src/core/state.js');
 state.accountDirectory.push({handle:'@search-owner',followers:['@aribloom'],following:['@noahvale']});
 const {getProfileConnections}=app.exportsOf('src/features/profile.events.js');
 assert.equal(getProfileConnections('@search-owner','followers','  ARI  ').length,1);
 assert.equal(getProfileConnections('@search-owner','followers','@aribloom').length,1);
 assert.equal(getProfileConnections('@search-owner','followers','noah').length,0);
 assert.equal(getProfileConnections('@search-owner','following','NOAH').length,1);
 assert.equal(getProfileConnections('@search-owner','following','').length,1);
});
test('accounts the viewer follows come first in both lists, with stable ordering and search',async()=>{
 const app=await loadApp();const {state}=app.exportsOf('src/core/state.js');
 const {getProfileConnections}=app.exportsOf('src/features/profile.events.js');
 for(const handle of ['@sort-a','@sort-b','@sort-c','@sort-d']) state.accountDirectory.push({handle,name:'Sort '+handle,followers:[],following:[]});
 const handles=['@sort-a','@sort-b','@sort-c','@sort-d'];
 state.accountDirectory.push({handle:'@sort-owner',followers:handles,following:handles});
 state.followedAccountHandles.add('@sort-b');state.followedAccountHandles.add('@sort-d');
 for(const kind of ['followers','following']) {
  assert.deepEqual(Array.from(getProfileConnections('@sort-owner',kind),p=>p.handle),['@sort-b','@sort-d','@sort-a','@sort-c']);
  assert.deepEqual(Array.from(getProfileConnections('@sort-owner',kind,'sort-c'),p=>p.handle),['@sort-c']);
 }
});
