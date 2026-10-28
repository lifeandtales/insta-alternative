import test from 'node:test';
import assert from 'node:assert/strict';
import {loadApp} from './helpers/app-harness.js';

test('Post starts with a file chooser and opens editing only after Start editing',async()=>{
    for(const [mime,name]of [['image/jpeg','photo.jpg'],['video/mp4','clip.mp4']]){
        const app=await loadApp(),{state}=app.exportsOf('src/core/state.js'),create=app.exportsOf('src/features/create.js');
        create.openCreateUpload('post');assert.equal(app.element('.create-picker-step').hidden,false);assert.equal(app.element('.create-editor-step').hidden,true);assert.equal(app.element('.create-start-editing').disabled,true);assert.equal(create.startCreateEditing(),false);
        const file=new Blob(['fixture'],{type:mime});Object.defineProperty(file,'name',{value:name});
        const upload=app.element('#post-upload');upload.files=[file];
        app.listeners.find(l=>l.key==='#post-upload'&&l.type==='change').callback({target:upload});
        assert.equal(state.createMediaItems.length,1);assert.equal(state.createMediaItems[0].ratio,'original');assert.equal(app.element('.create-editor-step').hidden,true);assert.equal(app.element('.create-start-editing').disabled,false);assert.equal(app.element('.create-file-selection').textContent,name);
        const chosen=state.createMediaUrl;assert.equal(create.startCreateEditing(),true);assert.equal(state.createMediaUrl,chosen);assert.equal(app.element('.create-picker-step').hidden,true);assert.equal(app.element('.create-editor-step').hidden,false);assert.equal(app.element('#create-upload-title').textContent,'Edit post');assert.equal(state.createCoverIndex,0);
    }
});

test('empty tag search has no suggestions; followed accounts rank before global public and private matches',async()=>{
    const app=await loadApp(),{state}=app.exportsOf('src/core/state.js'),create=app.exportsOf('src/features/create.js');
    state.accountDirectory=[{name:'A global public',handle:'@alex_public',isPrivate:false},{name:'B global private',handle:'@alex_private',isPrivate:true},{name:'Z followed',handle:'@alex_followed',isPrivate:true},{name:'Blocked',handle:'@alex_blocked'}];
    state.followedAccountHandles=new Set(['@alex_followed']);state.blockedHandles=new Set(['@alex_blocked']);
    assert.equal(create.searchCreateTagAccounts('').length,0);assert.equal(create.searchCreateTagAccounts('   ').length,0);assert.equal(create.searchCreateTagAccounts('@').length,0);
    assert.deepEqual(Array.from(create.searchCreateTagAccounts('alex'),x=>x.handle),['@alex_followed','@alex_public','@alex_private']);assert.equal(create.searchCreateTagAccounts('alex_private')[0].isPrivate,true);
    app.element('#create-tag-search').value='';create.renderCreateTags();assert.equal(app.element('#create-tag-results').innerHTML,'');
});

test('tag selection and removal keep the exact handles for publishing; canceling the chooser does not open editing',async()=>{
    const app=await loadApp(),{state}=app.exportsOf('src/core/state.js'),create=app.exportsOf('src/features/create.js'),events=app.exportsOf('src/features/create.events.js');
    create.openCreateUpload('post');
    app.listeners.find(l=>l.key==='#post-upload'&&l.type==='change').callback({target:{files:[]}});assert.equal(state.createMediaItems.length,0);assert.equal(app.element('.create-editor-step').hidden,true);
    app.element('#create-tag-search').value='ari';
    const event=(selector,dataset)=>({target:{closest:s=>s===selector?{dataset}:null}});
    events.handleCreateUploadClick(event('[data-create-tag]',{createTag:'@aribloom'}));assert.equal(app.element('#create-tags').value,'@aribloom');
    events.handleCreateUploadClick(event('[data-create-tag-remove]',{createTagRemove:'@aribloom'}));assert.equal(app.element('#create-tags').value,'');
});

test('closing after file selection does not focus hidden save controls; edits still get a save/discard choice',async()=>{
    const app=await loadApp(),{state}=app.exportsOf('src/core/state.js'),create=app.exportsOf('src/features/create.js');
    create.openCreateUpload('post');state.createMediaItems=[{type:'image',url:'fixture.jpg',fit:'contain',x:50,y:50}];state.createMediaUrl='fixture.jpg';
    create.closeCreateUpload();assert.equal(app.element('.create-upload-backdrop').hidden,true);
    create.openCreateUpload('post');state.createMediaItems=[{type:'image',url:'fixture.jpg',fit:'contain',x:50,y:50}];state.createMediaUrl='fixture.jpg';
    create.startCreateEditing();create.closeCreateUpload();assert.equal(app.element('.create-upload-backdrop').hidden,false);assert.equal(app.element('.create-exit-dialog').hidden,false);create.closeCreateUpload(true);assert.equal(app.element('.create-upload-backdrop').hidden,true);
});

test('Next freezes per-item media edits and keeps caption and sharing on the details step',async()=>{
    const app=await loadApp(),{state}=app.exportsOf('src/core/state.js'),create=app.exportsOf('src/features/create.js');
    create.openCreateUpload('post');
    state.createMediaItems=[{type:'video',url:'test.mp4',text:'Amazing view',ratio:'4/5',brightness:120,originalAudioMuted:true}];
    create.startCreateEditing();
    assert.equal(app.element('.create-editor-fields').hidden,true);assert.equal(app.element('.create-media-editing').hidden,false);
    create.setCreateDetails(true);
    assert.equal(app.element('.create-editor-fields').hidden,false);assert.equal(app.element('.create-media-editing').hidden,true);
    assert.equal(state.createFinalizedItems[0].text,'Amazing view');assert.equal(state.createFinalizedItems[0].originalAudioMuted,true);
    state.createMediaItems[0].text='changed';assert.equal(state.createFinalizedItems[0].text,'Amazing view');
    create.setCreateDetails(false);assert.equal(state.createFinalizedItems,null);
});

test('selection and adding more enforce the 20-item limit without replacing existing edits',async()=>{
    const app=await loadApp(),{state}=app.exportsOf('src/core/state.js'),create=app.exportsOf('src/features/create.js');
    create.openCreateUpload('post');
    const select=app.listeners.find(l=>l.key==='#post-upload'&&l.type==='change').callback;
    const file=new Blob(['fixture'],{type:'image/jpeg'});
    select({target:{files:Array(20).fill(file)}});assert.equal(state.createMediaItems.length,20);
    state.createMediaItems[0].text='Keep my text';state.createAppending=true;
    select({target:{files:[file]}});assert.equal(state.createMediaItems.length,20);assert.equal(state.createMediaItems[0].text,'Keep my text');
    state.createMediaItems.pop();select({target:{files:[file]}});assert.equal(state.createMediaItems.length,20);assert.equal(state.createMediaItems[0].text,'Keep my text');
});

test('published media preserves filters, aspect, text and original-audio mute, escaping text',async()=>{
    const app=await loadApp(),media=app.exportsOf('src/features/post-media.js');
    const markup=media.renderEditedMedia({type:'video',url:'clip.mp4',ratio:'4/5',filter:'mono',brightness:120,text:'<b>Hello</b>',originalAudioMuted:true});
    assert.match(markup,/aspect-ratio:0.8/);assert.match(markup,/brightness\(120%\)/);assert.match(markup,/grayscale\(1\)/);assert.match(markup,/data-original-audio-muted="true"/);assert.match(markup,/&lt;b&gt;Hello&lt;\/b&gt;/);assert.doesNotMatch(markup,/<b>Hello/);
    assert.doesNotMatch(media.renderEditedMedia({type:'video',url:'clip.mp4',originalAudioMuted:false}),/data-original-audio-muted/);
});

test('scheduled posts publish only when due, once, into the correct profile media list',async()=>{
    const app=await loadApp(),{state}=app.exportsOf('src/core/state.js'),{posts,reels}=app.exportsOf('src/data/sample-data.js'),create=app.exportsOf('src/features/create.js');
    state.scheduledPosts=[{type:'post',scheduledAt:100,item:{...posts[0],id:98765}},{type:'reel',scheduledAt:200,item:{...reels[0],id:98766}}];
    assert.equal(create.processScheduledPosts(99),0);assert.equal(create.processScheduledPosts(100),1);assert.equal(posts[0].id,98765);assert.equal(state.scheduledPosts.length,1);assert.equal(create.processScheduledPosts(200),1);assert.equal(reels[0].id,98766);assert.equal(create.processScheduledPosts(201),0);assert.equal(posts.filter(item=>item.id===98765).length,1);
});

test('post text drags and pinches on a fixed canvas without jumps when fingers are added or lifted',async()=>{
    const app=await loadApp(),{bindPostTextGestures}=app.exportsOf('src/features/post-media.js');
    const handlers={},keys={},captures=new Set(),classes=new Set();let changed=0;
    const text={style:{},setAttribute(){},addEventListener(type,handler){keys[type]=handler;}};
    const stage={querySelector:()=>text,getBoundingClientRect:()=>({width:400,height:800}),classList:{add:v=>classes.add(v),remove:v=>classes.delete(v)},addEventListener(type,handler){handlers[type]=handler;},setPointerCapture:id=>captures.add(id),hasPointerCapture:id=>captures.has(id),releasePointerCapture:id=>captures.delete(id)};
    const item={text:'Hello',textX:50,textY:50,textSize:6};
    bindPostTextGestures(stage,item,()=>changed++);
    const event=(pointerId,x,y)=>({pointerId,clientX:x,clientY:y,button:0,target:{closest:()=>text},preventDefault(){},stopPropagation(){}});
    handlers.pointerdown(event(1,200,400));handlers.pointermove(event(1,240,480));assert.equal(item.textX,60);assert.equal(item.textY,60);
    handlers.pointerdown(event(2,340,480));handlers.pointermove(event(2,440,480));assert.equal(item.textSize,12);assert.equal(item.textX,72.5);
    handlers.pointerup(event(2,440,480));handlers.pointermove(event(1,240,480));assert.equal(item.textX,72.5);assert.equal(item.textSize,12);
    handlers.pointermove(event(1,200,400));assert.equal(item.textX,62.5);assert.equal(item.textY,50);
    handlers.pointercancel(event(1,200,400));assert.equal(captures.size,0);assert.equal(classes.has('post-text-dragging'),false);
    handlers.pointermove(event(1,0,0));assert.equal(item.textX,62.5);
    keys.keydown({key:'ArrowRight',preventDefault(){},stopPropagation(){}});assert.equal(item.textX,63.5);assert.ok(changed>0);
});

test('filter swipes select a direction only for a deliberate horizontal gesture',async()=>{
    const app=await loadApp(),{bindPostFilterSwipe}=app.exportsOf('src/features/post-media.js');
    const handlers={},captures=new Set(),directions=[];
    const stage={classList:{add(){}},addEventListener(type,handler){handlers[type]=handler;},setPointerCapture:id=>captures.add(id),hasPointerCapture:id=>captures.has(id),releasePointerCapture:id=>captures.delete(id)};
    bindPostFilterSwipe(stage,value=>directions.push(value));
    const event=(id,x,y)=>({pointerId:id,clientX:x,clientY:y,button:0,target:{closest:()=>null}});
    handlers.pointerdown(event(1,100,100));handlers.pointerup(event(1,40,105));
    handlers.pointerdown(event(2,100,100));handlers.pointerup(event(2,160,105));
    handlers.pointerdown(event(3,100,100));handlers.pointerup(event(3,110,200));
    handlers.pointerdown(event(4,100,100));handlers.pointercancel();handlers.pointerup(event(4,0,100));
    assert.deepEqual(directions,[1,-1]);
});

test('post filter tools use a horizontal strip, Rotate is absent, and Next preserves crop and filter',async()=>{
    const app=await loadApp(),{state}=app.exportsOf('src/core/state.js'),create=app.exportsOf('src/features/create.js');
    create.openCreateUpload('post');state.createMediaItems=[{type:'image',url:'photo.jpg',ratio:'16/9',filter:'warm',x:80,y:25}];create.startCreateEditing();
    assert.doesNotMatch(app.element('.create-media-controls').innerHTML,/Rotate/);
    state.createTool='filters';create.renderCreatePreview();assert.match(app.element('.create-media-controls').innerHTML,/create-filter-strip/);assert.doesNotMatch(app.element('.create-media-controls').innerHTML,/<select/);
    create.setCreateDetails(true);assert.equal(state.createFinalizedItems[0].ratio,'16/9');assert.equal(state.createFinalizedItems[0].x,80);assert.equal(state.createFinalizedItems[0].filter,'warm');
});

test('twenty distinct post filters plus Original are available and preserved for publishing',async()=>{
    const app=await loadApp(),{POST_FILTERS,mediaEdits,mediaFilter,renderEditedMedia}=app.exportsOf('src/features/post-media.js');
    assert.equal(POST_FILTERS.length,21);assert.equal(new Set(POST_FILTERS.map(filter=>filter.id)).size,21);assert.equal(new Set(POST_FILTERS.map(filter=>filter.effect)).size,21);
    for(const filter of POST_FILTERS){assert.equal(mediaEdits({filter:filter.id}).filter,filter.id);assert.ok(mediaFilter({filter:filter.id}).includes(filter.effect));assert.match(renderEditedMedia({type:'image',url:'photo.jpg',filter:filter.id}),/post-media-stage/);}
    assert.equal(mediaEdits({filter:'unsupported'}).filter,'none');
});

test('regular posts cannot become excessively tall or wide, including old Original and 9:16 uploads',async()=>{
    const app=await loadApp(),{mediaAspect,mediaFit,renderEditedMedia}=app.exportsOf('src/features/post-media.js');
    assert.equal(mediaAspect({ratio:'original',naturalRatio:.1}),.75);assert.equal(mediaFit({ratio:'original',naturalRatio:.1}),'cover');
    assert.equal(mediaAspect({ratio:'original',naturalRatio:10}),1.91);assert.equal(mediaFit({ratio:'original',naturalRatio:10}),'cover');
    assert.equal(mediaAspect({ratio:'9/16'}),.75);assert.equal(mediaAspect({ratio:'4/5'}),.8);assert.equal(mediaAspect({ratio:'3/4'}),.75);
    assert.equal(mediaAspect({ratio:'9/16',layout:'reel'}),9/16);
    assert.match(renderEditedMedia({type:'image',url:'long.jpg',ratio:'original',naturalRatio:.1}),/aspect-ratio:0.75/);
});

test('reordering preserves edits, current selection, cover identity and the first media type',async()=>{
    const app=await loadApp(),{state}=app.exportsOf('src/core/state.js'),create=app.exportsOf('src/features/create.js');create.openCreateUpload('post');
    const photo={type:'image',url:'one.jpg',text:'Keep me',filter:'warm'},video={type:'video',url:'two.mp4',originalAudioMuted:true},last={type:'image',url:'three.jpg'};
    state.createMediaItems=[photo,video,last];state.createCoverIndex=1;state.createActiveIndex=0;create.startCreateEditing();
    assert.equal(create.reorderCreateMedia(1,0),true);assert.equal(state.createMediaItems[0],video);assert.equal(state.createCoverIndex,0);assert.equal(state.createActiveIndex,1);assert.equal(state.createMediaFile.type,'video/mp4');assert.equal(state.createMediaUrl,'two.mp4');assert.equal(state.createMediaItems[1].text,'Keep me');
    create.setCreateDetails(true);assert.equal(state.createFinalizedItems[0].originalAudioMuted,true);assert.equal(create.reorderCreateMedia(0,1),false);
});

test('removing an item preserves the others, replaces a removed cover and supports an empty editor',async()=>{
    const app=await loadApp(),{state}=app.exportsOf('src/core/state.js'),create=app.exportsOf('src/features/create.js');create.openCreateUpload('post');
    state.createMediaItems=[{type:'video',url:'one.mp4'},{type:'image',url:'two.jpg',text:'Keep'}];state.createCoverIndex=0;create.startCreateEditing();
    assert.equal(create.removeCreateMedia(0),true);assert.equal(state.createMediaItems.length,1);assert.equal(state.createMediaFile.type,'image/jpeg');assert.equal(state.createCoverIndex,0);assert.equal(state.createMediaItems[0].text,'Keep');
    assert.equal(create.removeCreateMedia(0),true);assert.equal(state.createMediaItems.length,0);assert.equal(state.createCoverIndex,null);assert.equal(state.createMediaUrl,'');assert.equal(app.element('.create-next').disabled,true);assert.equal(app.element('.create-add-media').hidden,false);
    state.createAppending=true;const file=new Blob(['fixture'],{type:'image/jpeg'});app.listeners.find(listener=>listener.key==='#post-upload'&&listener.type==='change').callback({target:{files:[file]}});
    assert.equal(state.createMediaItems.length,1);assert.equal(state.createCoverIndex,0);assert.ok(state.createMediaFile);assert.equal(app.element('.create-next').disabled,false);
});
