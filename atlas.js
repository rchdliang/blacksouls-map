const data=atlasData, maps=data.maps;
const artUrls=new Map();
function artSource(path){
    if(!data.art)return path;
    if(!artUrls.has(path)){
        const binary=atob(data.art[path]),bytes=new Uint8Array(binary.length);
        for(let i=0;i<binary.length;i++)bytes[i]=binary.charCodeAt(i);
        artUrls.set(path,URL.createObjectURL(new Blob([bytes],{type:'image/webp'})));
    }
    return artUrls.get(path);
}
const $=id=>document.getElementById(id), stage=$('stage'), area=$('area'); 
const tileSheets=new Map();
let paintedScene=null,mapArtReady=Promise.resolve();
if(data.tiles){
    const canvas=document.createElement('canvas'),image=$('mapimg');
    canvas.id=image.id;canvas.setAttribute('role','img');canvas.setAttribute('aria-label',image.alt);
    canvas.style.imageRendering='pixelated';image.replaceWith(canvas);
}
function tileSheet(page){
    if(!tileSheets.has(page)){
        const image=new Image();
        image.src=artSource(data.tiles.pages[page]);
        tileSheets.set(page,image.decode().then(()=>image));
    }
    return tileSheets.get(page);
}
function paintScene(canvas,scene,width,height){
    if(paintedScene===scene)return;
    paintedScene=scene;
    canvas.width=width*32;canvas.height=height*32;
    const {columns,layouts}=data.tiles,perSheet=columns*columns;
    const bytes=atob(layouts[scene]),layout=new Uint16Array(width*height),needed=new Set();
    for(let i=0;i<layout.length;i++){
        layout[i]=bytes.charCodeAt(2*i)+256*bytes.charCodeAt(2*i+1);
        needed.add(Math.floor(layout[i]/perSheet));
    }
    mapArtReady=Promise.all([...needed].map(async page=>[page,await tileSheet(page)])).then(entries=>{
        if(paintedScene!==scene)return;
        const sheets=new Map(entries),ctx=canvas.getContext('2d',{alpha:false});
        for(let i=0;i<layout.length;i++){
            const index=layout[i],slot=index%perSheet;
            ctx.drawImage(sheets.get(Math.floor(index/perSheet)),slot%columns*32,Math.floor(slot/columns)*32,
                32,32,i%width*32,Math.floor(i/width)*32,32,32);
        }
    });
}
let id,m,zoom,fit=true,loc=null,historyStack=[],grid;
const code=n=>String(n).padStart(3,'0'),title=n=>[regionByMap.get(+n),maps[n].part].filter(Boolean).join(' · ');
const travelOrder=data.areas.flatMap(([,ids])=>ids);
const rank=new Map(travelOrder.map((n,i)=>[n,i]));
const arrivals=new Map(travelOrder.map(n=>[n,[]]));
for(const from of travelOrder){
    for(const [,,dest,x,y,automatic] of maps[from].e){
        if(!automatic) arrivals.get(dest).push({from,x,y});
    }
}
const steps=[[0,1,1,8],[-1,0,2,4],[1,0,4,2],[0,-1,8,1]];
let origin=null,frame=null;
function keyOf(x,y){return y*m.w+x}
function neighbor(p,dx,dy){
    let x=p%m.w+dx, y=Math.floor(p/m.w)+dy;
    if(m.loop&2)x=(x+m.w)%m.w;
    if(m.loop&1)y=(y+m.h)%m.h;
    return x<0||y<0||x>=m.w||y>=m.h?-1:keyOf(x,y);
}
function entrance(previous,point,kept){
    if(kept)return kept;
    if(point && point[2]==='落点')return [point[0],point[1],'落点'];
    const choices=arrivals.get(id).slice();
    function order(a){if(a.from===previous)return -10000;if(id===127&&a.from===104)return -1000;const d=rank.get(id)-rank.get(a.from);return d>=0?d:200-d}
    choices.sort((a,b)=>order(a)-order(b));
    const open=choices.find(a=>grid[keyOf(a.x,a.y)]!==15);
    if(open)return [open.x,open.y,'参考入口'];
    return null;
}
let originalGrid,normalGraph,openGraph,graphs,waterCells,crossingRegions;
// Overlapping squares have two node IDs. The second copy is the passage below the bridge.
function routeNeighbor(p,dx,dy){
    if(!crossingRegions)return neighbor(p,dx,dy);
    const size=crossingRegions.length,cell=p%size,q=neighbor(cell,dx,dy);
    if(q<0)return -1;
    const from=crossingRegions[cell],to=crossingRegions[q];
    if(to===63)return from===61||p>=size?q+size:q;
    if(from===63&&to!==(p>=size?61:62))return -1;
    return q;
}
function passages(enabled){
    const grid=crossingRegions?new Uint8Array(originalGrid.length*2).fill(15):originalGrid.slice(),forced=new Set();
    if(crossingRegions){
        grid.set(originalGrid);
        crossingRegions.forEach((region,p)=>{if(region===63)grid[p+originalGrid.length]=grid[p]});
    }
    const blocked=new Set(m.solid.map(([x,y])=>keyOf(x,y)));
    for(const [name,[,x,y]] of visibleNpcs.get(id)||[]){
        if(people[name].routeMaps.includes(id)&&!encounterPoint(name,x,y))blocked.add(keyOf(x,y));
    }
    for(const [x,y] of m.routeItems||[])blocked.add(keyOf(x,y));
    if(enabled==='all')for(const [x,y] of m.passAfter||[])blocked.delete(keyOf(x,y));
    for(const sc of m.shortcuts){
        for(const [x,y] of [...sc.off,...sc.on])blocked.delete(keyOf(x,y));
    }
    for(const sc of m.shortcuts){
        const open=Boolean(sc.item)||enabled==='all'||enabled===sc.key;
        for(const [x,y] of open?sc.on:sc.off)blocked.add(keyOf(x,y));
        if(open)for(const p of sc.region){forced.add(p);grid[p]=0}
    }
    if(waterCells)for(let p=0;p<grid.length;p++)if(waterCells[p])grid[p]=0;
    if(enabled==='all')for(const [x,y,flag] of m.openedGround||[])grid[keyOf(x,y)]=flag;
    for(const p of blocked)grid[p]=15;
    const docks=new Set((m.docks||[]).map(([x,y])=>keyOf(x,y)));
    const jumps=new Map();
    for(const [x,y,tx,ty,locked] of m.jumps||[]){
        if(!locked||enabled==='all')jumps.set(keyOf(x,y),keyOf(tx,ty));
    }
    return {grid,forced,jumps,docks,afterFall:enabled==='afterFall'||enabled==='all',cache:new Map()};
}
function stoppingTiles(graph){
    const actions=new Set(m.actionExits.map(([x,y])=>keyOf(x,y)));
    const portals=new Set(m.e.filter(e=>!e[5]).map(e=>keyOf(e[0],e[1])).filter(p=>!actions.has(p)));
    for(const [x,y] of m.hiddenPortals)if(!actions.has(keyOf(x,y)))portals.add(keyOf(x,y));
    if(graph.afterFall)for(const [x,y] of m.passAfter||[])portals.delete(keyOf(x,y));
    for(const [x,y] of m.falls){
        if(graph.afterFall && onceAt(x,y))portals.delete(keyOf(x,y));
        else portals.add(keyOf(x,y));
    }
    return portals;
}
function routeTree(graph,first){
    if(graph.cache.has(first))return graph.cache.get(first);
    const total=graph.grid.length,dist=new Int32Array(total).fill(-1),prev=new Int32Array(total).fill(-1);
    const portals=graph.portals??=stoppingTiles(graph);
    if(first>=0 && graph.grid[first]!==15){
        const queue=new Int32Array(total);queue[0]=first;dist[first]=0;
        for(let head=0,tail=1;head<tail;head++){
            const p=queue[head];
            if(p!==first && portals.has(p))continue;
            if(graph.jumps.has(p)){
                const landing=graph.jumps.get(p);
                if(dist[landing]<0){prev[landing]=p;dist[landing]=dist[p]+1;queue[tail++]=landing;}
                continue;
            }
            for(const [dx,dy,side,back] of steps){
                const q=routeNeighbor(p,dx,dy);
                if(q<0||dist[q]>=0)continue;
                if(waterCells&&waterCells[p]!==waterCells[q]&&!graph.docks.has(waterCells[p]?p:q))continue;
                if(!graph.forced.has(q)&&((graph.grid[p]&side)||(graph.grid[q]&back)))continue;
                prev[q]=p;dist[q]=dist[p]+1;queue[tail++]=q;
            }
        }
    }
    const result={dist,prev};
    if(graph.cache.size>=12)graph.cache.delete(graph.cache.keys().next().value);
    graph.cache.set(first,result);return result;
}
function pathTo(graph,first,targets){
    const {dist,prev}=routeTree(graph,first);
    let end=-1;
    for(const q of targets)if(q>=0&&dist[q]>=0&&(end<0||dist[q]<dist[end]))end=q;
    if(end<0)return null;
    const path=[];for(let p=end;p>=0;p=prev[p])path.push(p);
    return path.reverse();
}
function addEdges(edges,path){
    if(!path)return;
    for(let i=1;i<path.length;i++){
        const size=m.w*m.h,under=path[i-1]>=size||path[i]>=size;
        const a=path[i-1]%size,b=path[i]%size;
        if(Math.abs(a%m.w-b%m.w)+Math.abs(Math.floor(a/m.w)-Math.floor(b/m.w))===1)
            edges.add((Math.min(a,b)+(under?size:0))*4+(Math.floor(a/m.w)===Math.floor(b/m.w)?0:1));
        else if((m.loop&2) && Math.floor(a/m.w)===Math.floor(b/m.w) && Math.abs(a-b)===m.w-1)
            edges.add(Math.min(a,b)*4+2);
        else if((m.loop&1) && a%m.w===b%m.w && Math.abs(a-b)===(m.h-1)*m.w)
            edges.add(Math.min(a,b)*4+3);
    }
}
function svgItem(parent,tag,attrs){
    const el=document.createElementNS('http://www.w3.org/2000/svg',tag);
    for(const [k,v] of Object.entries(attrs))el.setAttribute(k,v);
    parent.append(el);return el;
}
function drawEdges(edges,conditional,kind=conditional?'conditional':'regular'){
    if(!edges.size)return;
    let d='';
    for(const edge of edges){
        const a=Math.floor(edge/4),axis=edge%4;
        if(axis===2){const y=Math.floor(a/m.w)+.5;d+='M0 '+y+'L0.5 '+y+'M'+(m.w-.5)+' '+y+'L'+m.w+' '+y;continue;}
        if(axis===3){const x=a%m.w+.5;d+='M'+x+' 0L'+x+' 0.5M'+x+' '+(m.h-.5)+'L'+x+' '+m.h;continue;}
        const b=a+(axis===0?1:m.w);
        d+='M'+(a%m.w+.5)+' '+(Math.floor(a/m.w)+.5)+'L'+(b%m.w+.5)+' '+(Math.floor(b/m.w)+.5);
    }
    const style=conditional?{'stroke-dasharray':'.25 .13'}:kind==='underpass'?{'stroke-dasharray':'.23 .19'}:{};
    const colors=kind==='underpass'?[['#273749',.20],['#b8daff',.11]]:kind==='boat'?[['#153955',.27],['#8dd9ff',.15]]:conditional?[['#583012',.27],['#ffbb65',.15]]:[['#13382e',.25],['#8af9bd',.13]];
    for(const [color,width] of colors)
        svgItem($('lines'),'path',{d,stroke:color,'stroke-width':width,fill:'none','stroke-linecap':'round','data-route':kind,...style});
}
function finishLayers(regular,conditional){
    const bridgeEdges=new Set(),mechanismCells=new Set();
    for(const sc of m.shortcuts){
        if(sc.item)continue;
        if(sc.bridge){
            const [x,y,endX,endY]=sc.bridge;
            const dx=Math.sign(endX-x),dy=Math.sign(endY-y);
            const deck=[];
            for(let i=0;i<=Math.max(Math.abs(endX-x),Math.abs(endY-y));i++)deck.push(keyOf(x+i*dx,y+i*dy));
            addEdges(bridgeEdges,deck);
        }else{
            for(const p of sc.region)mechanismCells.add(p);
            const stayBlocked=new Set(sc.on.map(([x,y])=>keyOf(x,y)));
            for(const [x,y] of sc.off)if(!stayBlocked.has(keyOf(x,y)))mechanismCells.add(keyOf(x,y));
        }
    }
    for(const [x,y] of m.falls)if(onceAt(x,y))mechanismCells.add(keyOf(x,y));
    for(const [x,y] of m.openedGround||[])mechanismCells.add(keyOf(x,y));
    for(const edge of regular)conditional.delete(edge);
    const highlighted=new Set();
    for(const edge of conditional){
        const a=Math.floor(edge/4),b=a+(edge%4===0?1:m.w);
        if(bridgeEdges.has(edge)||mechanismCells.has(a)||mechanismCells.has(b))highlighted.add(edge);
        else regular.add(edge);
    }
    if(waterCells){
        const boat=new Set();
        for(const edge of regular){
            const a=Math.floor(edge/4),b=a+(edge%4===0?1:m.w);
            if(waterCells[a]||waterCells[b]){boat.add(edge);regular.delete(edge);}
        }
        drawEdges(boat,false,'boat');
    }
    if(crossingRegions){
        const lower=new Set(),offset=crossingRegions.length*4;
        for(const edge of regular)if(edge>=offset){lower.add(edge-offset);regular.delete(edge)}
        drawEdges(lower,false,'underpass');
    }
    drawEdges(regular,false);drawEdges(highlighted,true);
}
function approaches(x,y,adjacent){
    const p=keyOf(x,y);return adjacent?steps.map(([dx,dy])=>neighbor(p,dx,dy)).filter(q=>q>=0):[p];
}
function encounterPoint(name,x,y){
    return people[name].encounters?.find(([scene,px,py])=>scene===id&&px===x&&py===y);
}
function npcApproaches(name,x,y){
    return approaches(x,y,!encounterPoint(name,x,y)?.[3]);
}
function coverEntrances(graph,seeds,goals,edges){
    const network=new Map(),portals=graph.portals??=stoppingTiles(graph);
    function link(a,b){
        if(!network.has(a))network.set(a,new Set());
        network.get(a).add(b);
    }
    function trace(path){
        if(!path)return;
        addEdges(edges,path);
        for(let i=1;i<path.length;i++){
            const a=path[i-1],b=path[i];
            link(a,b);
            if(graph.jumps.has(a)||graph.jumps.has(b))continue;
            const back=steps.find(([dx,dy])=>routeNeighbor(b,dx,dy)===a);
            if(back&&(graph.forced.has(a)||(!(graph.grid[b]&back[2])&&!(graph.grid[a]&back[3]))))link(b,a);
        }
    }
    for(const first of seeds){
        if(graph.grid[first]===15)continue;
        if(network.size&&!network.has(first)){
            trace(pathTo(graph,first,[...network.keys()].filter(p=>!portals.has(p))));
        }
        const queue=[first],covered=new Set(queue);
        for(let h=0;h<queue.length;h++){
            const p=queue[h];if(p!==first&&portals.has(p))continue;
            for(const q of network.get(p)||[])if(!covered.has(q)){covered.add(q);queue.push(q);}
        }
        for(const targets of goals){
            if(!targets.some(p=>covered.has(p)))trace(pathTo(graph,first,targets));
        }
    }
}
function renderRoutes(){
    const svg=$('lines');svg.replaceChildren();
    const regular=new Set(),conditional=new Set(),actions=new Set(m.actionExits.map(([x,y])=>keyOf(x,y)));
    const selected=people[selectedNpc]?.points.filter(([scene,x,y])=>scene===id &&
        (!loc||loc[2]!==selectedNpc||(x===loc[0]&&y===loc[1])) &&
        (people[selectedNpc].routeMaps.includes(scene)||!landmarkDetail(selectedNpc,scene,x,y)))||[];
    const goals=[];
    if(selected.length){
        for(const [,x,y] of selected)goals.push(npcApproaches(selectedNpc,x,y));
    }
    for(const group of exitGroups(m.e)){
        if(group[0].scene)continue;
        goals.push(group.flatMap(c=>approaches(c.x,c.y,actions.has(keyOf(c.x,c.y))&&!fallAt(c.x,c.y))));
    }
    if(m.boundaryExit)goals.push([keyOf(...m.boundaryExit.slice(0,2))]);
    if(!selected.length||id===82){
        for(const [x,y] of m.f)goals.push(approaches(x,y,true));
        for(const [name,[,x,y]] of visibleNpcs.get(id)||[]){
            if(people[name].routeMaps.includes(id))goals.push(npcApproaches(name,x,y));
        }
        for(const [x,y] of m.routeItems||[])goals.push(approaches(x,y,true));
        for(const [x,y] of m.npcDoors||[])goals.push(approaches(x,y,true));
        for(const [x,y] of m.docks||[])goals.push([keyOf(x,y)]);
        for(const [x,y] of m.jumps||[])goals.push([keyOf(x,y)]);
        for(const sc of m.shortcuts)if(!sc.item && sc.control.length)goals.push(sc.control.flatMap(([x,y])=>approaches(x,y,true)));
    }
    const seeds=[];
    if(origin)seeds.push(keyOf(origin[0],origin[1]));
    for(const a of arrivals.get(id)){
        const p=keyOf(a.x,a.y);
        if(!seeds.includes(p))seeds.push(p);
    }
    for(const graph of graphs){
        coverEntrances(graph,seeds,goals,graph===normalGraph?regular:conditional);
    }
    // Draw the bank-to-bank detour and the bridge even when neither bank is an exit.
    for(const sc of m.shortcuts)if(sc.banks){
        const [a,b]=sc.banks.map(([x,y])=>keyOf(x,y));
        addEdges(regular,pathTo(normalGraph,a,[b]));addEdges(conditional,pathTo(openGraph,a,[b]));
    }
    for(const [x,y] of m.falls)if(onceAt(x,y)){
        const a=keyOf(x-1,y),b=keyOf(x+1,y);
        addEdges(regular,pathTo(normalGraph,a,[b]));
        addEdges(conditional,pathTo(openGraph,a,[b]));
    }
    finishLayers(regular,conditional);
    if(origin)svgItem(svg,'circle',{cx:origin[0]+.5,cy:origin[1]+.5,r:.22,fill:'#4bb8ff',stroke:'#fff','stroke-width':.08});
}
function fallAt(x,y){return m.falls.find(f=>f[0]===x&&f[1]===y)}
function onceAt(x,y){return id===41&&x===19&&y===33}
function fallName(f){
    if(onceAt(f[0],f[1]))return '一次性塌陷（B3F）';
    return (id===79?'断桥':'兔子洞')+'（落至'+maps[f[2]].n+'）';
}
function bridgeDirection(sc){return sc.bridge[2]<sc.bridge[0]?['东岸','西']:['西岸','东']}
function shortcutPanel(){
    const box=$('shortcutBox'),list=$('shortcutList');
    list.replaceChildren();
    const descriptions=new Set(m.eventNotes||[]);
    for(const sc of m.shortcuts){
        if(sc.item)continue;
        if(sc.bridge){const [bank,dir]=bridgeDirection(sc);descriptions.add('倒树桥从'+bank+'向'+dir+'放倒，之后可双向过桥。')}
        else if(sc.key.startsWith('sw'))descriptions.add(sc.hint+'。');
    }
    if(m.falls.length){
        if(id===41)descriptions.add('龟骑士西南侧的地面首次踩踏会塌陷，落到 B3F。事件过后地面恢复，可正常走过。');
        else if(id===79)descriptions.add('断桥缺口可单向落到污秽之沼。');
        else if(id===56)descriptions.add('从兔子洞跳下，单向抵达不思议之国。');
    }
    for(const text of descriptions){const row=document.createElement('p');row.textContent=text;list.append(row)}
    if(id===107)teaPartyRabbits(list);
    box.hidden=!list.children.length;
}
function showInteraction(){
    const arrows=$('directions');arrows.replaceChildren();
    arrows.setAttribute('viewBox','0 0 '+m.w+' '+m.h);
    for(const [x,y,,ty,locked] of m.jumps||[]){
        if(locked)continue; // A return jump unlocks later; the arrow marks the initial direction.
        const px=x+.5,ey=ty+.5,sign=Math.sign(ty-y);
        const d='M'+px+' '+(y+.5)+'V'+ey+'m-.24 '+(-sign*.46)+' .24 '+(sign*.46)+' .24 '+(-sign*.46);
        for(const [color,width] of [['#2c3024',.32],[id===72?'#ffbb65':'#8af9bd',.15]])
            svgItem(arrows,'path',{d,fill:'none',stroke:color,'stroke-width':width,'data-jump':'initial'});
    }
    for(const [x,y] of m.falls){
        const d='M'+(x+.5)+' '+(y-.5)+'v.75m-.28-.28.28.28.28-.28';
        for(const [color,width] of [['#481b29',.24],['#ffb3c1',.13]])
            svgItem(arrows,'path',{d,stroke:color,'stroke-width':width,fill:'none','stroke-linecap':'round'});
    }
    function symbol(x,y,type,hint){
        const el=document.createElement('span');el.className='mapSymbol';
        el.dataset.symbol=type;el.title=hint;el.setAttribute('role','img');el.setAttribute('aria-label',hint);
        const svg=svgItem(el,'svg',{viewBox:'0 0 20 20','aria-hidden':'true'});
        const paths={key:'M8.7 8.7L17 17m-3-3 2-2m-4 0 2-2 M9.5 6a3.5 3.5 0 1 1-7 0 3.5 3.5 0 1 1 7 0Z',
            lever:'M3 16h14M7 15l5-9m2-2a2 2 0 1 1-4 0 2 2 0 1 1 4 0Z',
            gate:'M3 17V4h14v13M7 5v11m6-11v11M3 10h14'};
        svgItem(svg,'path',{d:paths[type],stroke:'currentColor','stroke-width':1.8,'stroke-linecap':'round','stroke-linejoin':'round',fill:'none'});
        place(el,x,y);
    }
    for(const sc of m.shortcuts){
        if(sc.bridge){
            const [x,y,ex]=sc.bridge,sign=Math.sign(ex-x);
            const end=ex+.5,sy=y+.5;
            const d='M'+(x+.5)+' '+sy+'H'+end+' M'+(end-sign*.65)+' '+(sy-.43)+'L'+end+' '+sy+'L'+(end-sign*.65)+' '+(sy+.43);
            for(const [color,width] of [['#4b2a13',.33],['#ffd089',.17]])
                svgItem(arrows,'path',{d,stroke:color,'stroke-width':width,'stroke-linecap':'round',fill:'none'});
            continue;
        }
        for(const [x,y] of sc.control){
            symbol(x,y,sc.item?'key':(sc.key.startsWith('sw')?'lever':'gate'),sc.hint);
        }
        if(sc.key.startsWith('sw')&&!sc.bridge){
            for(const p of sc.region)symbol(p%m.w,Math.floor(p/m.w),'gate',sc.hint);
            for(const [x,y] of sc.off)if(!sc.control.some(([a,b])=>a===x&&b===y))symbol(x,y,'gate',sc.hint);
        }
    }
}


const regionMaps=new Map(data.areas);
const regionByMap=new Map();
for(const [region,ids] of regionMaps){
    $('areas').add(new Option(region,region));
    for(const mapId of ids)regionByMap.set(mapId,region);
}
function syncMapSelectors(){
    const region=regionByMap.get(id);
    $('areas').value=region;
    const select=$('maps');
    select.replaceChildren();
    for(const mapId of regionMaps.get(region)){
        const label=(maps[mapId].part||region)+(maps[mapId].f.length?'🔥':'');
        select.add(new Option(label,mapId));
    }
    select.value=id;
}
function size(){
    frame=m.frame||[0,0,m.w,m.h];
    const [x,y,w,h]=frame;
    if(fit)zoom=Math.min(1.5,area.clientWidth/(32*w),area.clientHeight/(32*h));
    const tile=32*zoom;
    if(m.recollections)stage.style.setProperty('--recall-tile',tile+'px');
    stage.style.setProperty('--npc-size',Math.min(32,Math.max(14,tile))+'px');
    const padX=Math.max(0,(area.clientWidth-w*tile)/2),padY=Math.max(0,(area.clientHeight-h*tile)/2);
    $('frame').style.width=(w*tile+2*padX)+'px';$('frame').style.height=(h*tile+2*padY)+'px';
    stage.style.width=m.w*tile+'px';stage.style.height=m.h*tile+'px';
    const img=$('mapimg');
    // Tile layouts cover the full image. The folder edition ships pre-cropped PNGs.
    const [ix,iy,iw,ih]=data.tiles?[0,0,m.w,m.h]:frame;
    img.style.position='absolute';img.style.left=ix*tile+'px';img.style.top=iy*tile+'px';
    img.style.width=iw*tile+'px';img.style.height=ih*tile+'px';
    const clip=m.frame?'inset('+[y,m.w-x-w,m.h-y-h,x].map(v=>v*tile+'px').join(' ')+')':'none';
    img.style.clipPath=data.tiles?clip:'none';
    $('lines').style.clipPath=clip;$('directions').style.clipPath=clip;
    if(data.tiles)paintScene(img,id,m.w,m.h);
    else{
        const source=artSource('场景/'+code(id)+'.png');
        if(img.getAttribute('src')!==source)img.src=source;
    }

    stage.style.left=(padX-x*tile)+'px';stage.style.top=(padY-y*tile)+'px';
    positionExitLabels();
}
function zoomAround(view,content,resize,anchor){
    const bounds=view.getBoundingClientRect(),before=content.getBoundingClientRect();
    if(!before.width||!before.height)return;
    const [x,y]=anchor||[bounds.left+view.clientWidth/2,bounds.top+view.clientHeight/2];
    const fx=(x-before.left)/before.width,fy=(y-before.top)/before.height;
    $('pinDetail').hidePopover();resize();
    const after=content.getBoundingClientRect();
    view.scrollBy(after.left+fx*after.width-x,after.top+fy*after.height-y);
}
function scale(value,anchor){
    zoomAround(area,stage,()=>{fit=false;zoom=Math.max(.05,Math.min(4,value));size()},anchor);
}
function openMap(n,point=null,record=true,keptOrigin=null,overview=false){
    if(!maps[n])return;
    if(!overview)setOverview(false);
    const previous=id,previousOrigin=origin;
    if(record && id!==undefined)historyStack.push([id,loc,origin]);
    $('pinDetail').hidePopover();
    id=+n;m=maps[id];loc=point;
    originalGrid=Uint8Array.from(atob(m.g),c=>c.charCodeAt(0));
    crossingRegions=m.crossingRegions?Uint8Array.from(atob(m.crossingRegions),c=>c.charCodeAt(0)):null;
    waterCells=m.boatWater?Uint8Array.from(atob(m.boatWater),(c,p)=>Number(originalGrid[p]===15&&c.charCodeAt(0)!==0)):null;
    normalGraph=passages('none');openGraph=passages('all');grid=openGraph.grid;
    graphs=[normalGraph];
    const conditional=m.shortcuts.filter(sc=>!sc.item);
    if(conditional.length>1)for(const sc of conditional)graphs.push(passages(sc.key));
    if(conditional.length||m.passAfter||m.openedGround||m.jumps?.some(j=>j[4])||m.falls.some(([x,y])=>onceAt(x,y)))graphs.push(openGraph);
    origin=entrance(previous,point,keptOrigin||(previous===id && point && point[2]!=='落点'?previousOrigin:null));
    $('name').textContent=title(id);$('name').title=m.subSource||'';
    syncMapSelectors();fit=!m.recollections;if(m.recollections)zoom=1.75;
    if(overview){setOverview(true);return}
    size();
    area.scrollTo(m.recollections?(area.scrollWidth-area.clientWidth)/2:0,0);$('lines').setAttribute('viewBox','0 0 '+m.w+' '+m.h);$('back').disabled=!historyStack.length;
    npcLocations();shortcutPanel();buildExits();
}


function showPinDetail(button,text){
    const tip=$('pinDetail'),r=button.getBoundingClientRect();
    tip.textContent=text;tip.showPopover();
    const box=tip.getBoundingClientRect();
    tip.style.left=Math.max(4,Math.min(innerWidth-box.width-4,r.left+(r.width-box.width)/2))+'px';
    tip.style.top=(r.top>box.height+8?r.top-box.height-5:Math.min(innerHeight-box.height-4,r.bottom+5))+'px';
}
function place(el,x,y){if(el.matches('.pin')){el.dataset.x=x+.5;el.dataset.y=y+.5;}el.style.left=(x+.5)/m.w*100+'%';el.style.top=(y+.5)/m.h*100+'%';$('pins').append(el)}
function exitGroups(events) {
    const cells = new Map();
    for (const [x, y, dest, dx, dy, scene] of events) {
        const key = [x, y, scene].join(',');
        if (!cells.has(key)) cells.set(key, {x, y, scene, targets: []});
        cells.get(key).targets.push([dest, dx, dy]);
    }
    function sameOpening(a, b) {
        if (a.targets.length !== b.targets.length) return false;
        return a.targets.every(([dest, x, y], index) => {
            const [next, nx, ny] = b.targets[index];
            return dest === next && ((x === nx && y === ny) ||
                (nx - x === b.x - a.x && ny - y === b.y - a.y));
        });
    }
    const groups = [];
    for (const [key, first] of cells) {
        const group = [first];
        cells.delete(key);
        if (!first.scene) {
            for (const cell of group) {
                const neighbors=[[cell.x-1,cell.y],[cell.x+1,cell.y],[cell.x,cell.y-1],[cell.x,cell.y+1]];
                if((id===6 && cell.y===0 && cell.targets[0][0]===34) ||
                   (id===39 && cell.y===20 && cell.targets[0][0]===38))
                    neighbors.push([cell.x-2,cell.y],[cell.x+2,cell.y]);
                for (const [x,y] of neighbors) {
                    const neighborKey = [x,y,false].join(',');
                    const neighbor = cells.get(neighborKey);
                    if (!neighbor || !sameOpening(cell,neighbor)) continue;
                    cells.delete(neighborKey);
                    group.push(neighbor);
                }
            }
        }
        groups.push(group);
    }
    return groups.sort((a,b) => Number(a[0].scene)-Number(b[0].scene));
}
function exitSide(cells,departure) {
    for(const [axis,start,end] of [['x','左','右'],['y','上','下']]){
        const values=[...new Set(cells.map(c=>c[axis]))].sort((a,b)=>a-b);
        if(values.length<2)continue;
        const index=values.indexOf(departure[axis]);
        if(index===0)return start+'侧';
        if(index===values.length-1)return end+'侧';
        return values.length===3?'中间':'从'+start+'数第 '+(index+1)+' 格';
    }
    return '';
}
function positionExitLabels(){
    const overlay=$('exitGuides');
    overlay.replaceChildren();
    const buttons=[...$('pins').querySelectorAll('.pin')];
    if(!buttons.length || !frame)return;
    const tile=32*zoom;
    const [fx,fy,fw,fh]=frame.map(n=>n*tile);
    const anchors=buttons.map(b=>[Number(b.dataset.x)*tile,Number(b.dataset.y)*tile]);
    const stageRect=stage.getBoundingClientRect();
    const frameRect=$('frame').getBoundingClientRect();
    const leftEdge=frameRect.left-stageRect.left,topEdge=frameRect.top-stageRect.top;
    const rightEdge=leftEdge+frameRect.width,bottomEdge=topEdge+frameRect.height;
    const occupied=[...$('pins').querySelectorAll('.firepin,.npcPin,.mapSymbol,.loc,.recallSpot')].map(el=>{
        const r=el.getBoundingClientRect();
        return [r.x-stageRect.x,r.y-stageRect.y,r.width,r.height];
    });
    occupied.push(...anchors.map(([x,y])=>[x-3,y-3,6,6]));
    const clamp=(n,lo,hi)=>Math.max(lo,Math.min(hi,n));
    function svgEl(tag,attrs){
        const el=document.createElementNS('http://www.w3.org/2000/svg',tag);
        for(const [k,v] of Object.entries(attrs))el.setAttribute(k,v);
        overlay.append(el);
    }
    buttons.forEach((b,i)=>{
        const [x,y]=anchors[i];
        b.style.maxWidth=Math.max(1,Math.min(frameRect.width,area.clientWidth)-4)+'px';
        const {width:w,height:h}=b.getBoundingClientRect();
        let xmin=fx+2,xmax=fx+fw-w-2,ymin=fy+2,ymax=fy+fh-h-2;
        let best=null,bestOverlap=Infinity,bestDistance=Infinity;
        function candidate(left,top){
            left=clamp(left,xmin,xmax);top=clamp(top,ymin,ymax);
            let overlap=0;
            for(const [ox,oy,ow,oh] of occupied){
                overlap+=Math.max(0,Math.min(left+w+2,ox+ow)-Math.max(left-2,ox))*
                    Math.max(0,Math.min(top+h+2,oy+oh)-Math.max(top-2,oy));
            }
            const ex=clamp(x,left,left+w),ey=clamp(y,top,top+h);
            const distance=Math.hypot(x-ex,y-ey)+0.04*Math.hypot(x-left-w/2,y-top-h/2);
            if(overlap<bestOverlap||(overlap===bestOverlap&&distance<bestDistance)){
                bestOverlap=overlap;bestDistance=distance;best=[left,top,ex,ey];
            }
        }
        if(xmax>=xmin&&ymax>=ymin)for(const gap of [7,16,30,48,74,108,150,200]){
            for(const offset of [0,-.45,.45,-1,1]){
                candidate(x-w/2+offset*w,y-gap-h);candidate(x-w/2+offset*w,y+gap);
                candidate(x+gap,y-h/2+offset*h);candidate(x-w-gap,y-h/2+offset*h);
            }
            if(bestOverlap===0&&bestDistance<gap+5)break;
        }
        // When the map edge or another label blocks a nearby slot, also try the
        // empty margins and the edges of occupied rectangles. Anchors stay fixed.
        if(bestOverlap>0){
            xmin=leftEdge+2;xmax=rightEdge-w-2;ymin=topEdge+2;ymax=bottomEdge-h-2;
            const xs=new Set([xmin,xmax,clamp(x-w/2,xmin,xmax)]);
            const ys=new Set([ymin,ymax,clamp(y-h-7,ymin,ymax),clamp(y+7,ymin,ymax)]);
            for(const [ox,oy,ow,oh] of occupied){
                xs.add(clamp(ox-w-3,xmin,xmax));xs.add(clamp(ox+ow+3,xmin,xmax));
                ys.add(clamp(oy-h-3,ymin,ymax));ys.add(clamp(oy+oh+3,ymin,ymax));
            }
            for(const lx of xs)for(const ty of ys)candidate(lx,ty);
        }
        const [left,top,ex,ey]=best;
        Object.assign(b.style,{left:left+'px',top:top+'px'});
        occupied.push([left,top,w,h]);
        svgEl('line',{x1:x,y1:y,x2:ex,y2:ey,stroke:'#302713','stroke-width':3});
        const npcLabel=b.classList.contains('npcName'),color=npcLabel?'#a3d8e6':b.classList.contains('itemName')?'#d8bddf':'#ffdf8f';
        svgEl('line',{x1:x,y1:y,x2:ex,y2:ey,stroke:color,'stroke-width':1.4});
        if(!npcLabel)svgEl('circle',{cx:x,cy:y,r:3,fill:color,stroke:'#31260e','stroke-width':1.2});
    });
}

function exitName(target){
    const [dest,x,y]=target;
    if(id===104&&dest===127)return '圣森 · 里线东侧';
    if(id===109&&dest===129)return '圣森 · 里线北侧';
    const from=m.site,to=maps[dest].site;
    const part=maps[dest].room;
    // Both storeys of this house are drawn on a single game map.
    if(id===22 && dest===22){
        if(x===4 && y===60)return '2F';
        if(x===28 && y===21)return '1F';
    }
    if(id===dest)return '通道出口';
    if(from===to){
        if(part==='屋内' || (/^屋外|^庭园/.test(m.room||'') && part==='1F'))return to;
        return part||to;
    }
    if(maps[dest].n!==to && part && [23,89,66,53].includes(dest))return part;
    const alternate=m.e.some(e=>!e[5] && e[2]!==dest && maps[e[2]].site===to);
    return alternate&&part?to+' · '+part:to;
}
// Each pair names one physical passage at both of its departure tiles.
const passageLabels=new Map();
for(const [a,b,doors] of [
    [62,63,[[12,5,12,5,'西北楼梯'],[38,5,38,5,'东北楼梯'],[42,26,42,26,'东侧楼梯']]],
    [63,64,[[5,39,5,38,'西南楼梯'],[28,43,28,43,'东南楼梯']]],
    [41,42,[[11,27,2,3,'西侧通道'],[47,38,38,14,'东侧通道']]],
    [27,28,[[18,7,12,0,'北门'],[18,17,12,35,'南门']]],
    [67,57,[[27,43,13,41,'墓园南街西屋'],[44,44,36,40,'南街长屋西门'],[48,44,41,40,'南街长屋东门'],
            [42,58,80,14,'河边小屋'],[15,64,44,14,'花田西屋'],[56,96,11,13,'城南小屋']]],
    [67,79,[[0,21,89,17,'桥面'],[0,78,89,32,'桥下岩台']]],
    [77,84,[[77,95,30,7,'楼梯口'],[73,104,35,16,'船侧门']]],
    [95,96,[[7,16,15,28,'西侧入口'],[53,16,43,28,'东侧入口']]]
]){
    for(const [x,y,tx,ty,label] of doors){
        passageLabels.set([a,b,x,y].join(','),label);
        passageLabels.set([b,a,tx,ty].join(','),label);
    }
}
// Only the eastern swamp entrance has a return transfer to the bridge.
passageLabels.set([79,82,51,35].join(','),'断桥跳落处');
passageLabels.set([79,82,84,39].join(','),'桥下岩台');
function buildExits() {
    const panel = $('exits');
    panel.replaceChildren();
    $('pins').replaceChildren();
    const groups = exitGroups(m.e);
    const destinations=new Map();

    for (const cells of groups) {
        const scene = cells[0].scene;
        const prefix = scene ? '事件 · ' : '';
        // exitGroups has already matched the destinations for every tile in this opening.
        // One real departure tile supplies the landing for each distinct way through.
        const first=cells[0];
        const fall=fallAt(cells[0].x,cells[0].y);
        const describe=t=>fall && fall[2]===t[0]?fallName(fall):exitName(t);
        const pinNames=new Set(),buttons=[];
        for(const target of first.targets){
            const [dest,dx,dy]=target,base=exitName(target),name=describe(target);
            const key=[scene,dest,id===dest?base:''].join('/');
            const passage=cells.map(c=>passageLabels.get([id,dest,c.x,c.y].join(','))).find(Boolean);
            pinNames.add(passage&&!fall?name+' · '+passage:name);
            if(!destinations.has(key))destinations.set(key,{base:prefix+base,entries:[]});
            const button=document.createElement('button');
            button.className='ex';
            button.onclick=()=>openMap(dest,[dx,dy,'落点']);
            const via=m.via?.[[first.x,first.y,dest,dx,dy].join(',')];
            destinations.get(key).entries.push({button,name:prefix+name,
                side:passage,first,via});
            buttons.push(button);
        }
        const names=[...pinNames].join(' / ');
        if (!scene) {
            const pin = document.createElement('button');
            pin.className = fall?'pin hazard':'pin';
            pin.textContent = names;
            pin.title = names;
            pin.setAttribute('aria-label','前往 ' + names);
            pin.onclick = ev => {
                
                ev.stopPropagation();
                if(buttons.length===1){buttons[0].click();return;}
                for(const button of buttons){
                    const choices=button.closest('details');if(choices)choices.open=true;
                }
                if($('sidebar').hidden)setSidebarClosed(false);
                buttons[0].focus();
            };
            const centerX = cells.reduce((sum,p)=>sum+p.x,0)/cells.length;
            const centerY = cells.reduce((sum,p)=>sum+p.y,0)/cells.length;
            // Use the centre of straight openings and a real cell for irregular openings.
            if (cells.every(p=>p.x === cells[0].x) || cells.every(p=>p.y === cells[0].y)) {
                place(pin,centerX,centerY);
            } else {
                const distance = p => (p.x-centerX)**2 + (p.y-centerY)**2;
                const middle = cells.reduce((a,b)=>distance(a)<=distance(b)?a:b);
                place(pin,middle.x,middle.y);
            }
        }
    }
    for(const {base,entries} of destinations.values()){
        let container=panel;
        if(entries.length>1){
            container=document.createElement('details');container.className='exitChoice';
            const summary=document.createElement('summary');summary.textContent=base;
            container.append(summary);panel.append(container);
        }
        for(const {button,name,side,first,via} of entries){
            button.textContent=entries.length===1?name:
                (side||(name!==base?name:exitSide(entries.map(e=>e.first),first))||'普通入口');
            if(via){
                const detail=document.createElement('small');detail.textContent='经'+via;button.append(detail);
            }
            container.append(button);
        }
    }
    if (!groups.length) panel.textContent = '未找到直接转移事件。';
    for(const [x,y,name] of m.npcDoors||[]){
        const label=document.createElement('span');
        label.className='pin';label.textContent=name;
        place(label,x,y);
    }
    if(m.bookshelves){
        for(const [x,y,title,item] of m.bookshelves){
            const label=document.createElement('button');label.className='pin shelfName';
            label.textContent=title;
            label.title=title===item?'放入《'+item+'》':'书架刻字《'+title+'》，放入《'+item+'》';
            label.onclick=ev=>{ev.stopPropagation();showPinDetail(ev.currentTarget,label.title);};
            place(label,x,y);
        }
    }
    if(m.innerBookshelves){
        const door=document.createElement('button');door.textContent='里间书架';
        door.onclick=ev=>{
                    ev.stopPropagation();
            const rows=$('innerRows');rows.replaceChildren();
            const byRow=new Map();
            for(const [,y,title] of m.innerBookshelves){
                if(!byRow.has(y)){
                    const row=document.createElement('div');row.className='shelfRow';rows.append(row);byRow.set(y,row);
                }
                const book=document.createElement('span');book.textContent=title;byRow.get(y).append(book);
            }
            $('shelfRoom').showModal();
        };
        panel.append(door);
    }
    if(m.boundaryExit){
        const [x,y,name]=m.boundaryExit;
        const row=document.createElement('div');row.textContent=name+'入口';panel.append(row);
        const label=document.createElement('span');label.className='pin';label.textContent=row.textContent;place(label,x,y);
    }
    if(id===127){
        const landing=arrivals.get(id).find(a=>a.from===104);
        const label=document.createElement('span');label.className='pin';label.textContent='图书室落点';place(label,landing.x,landing.y);
    }
    if(id===83){
        const landing=arrivals.get(id).find(a=>a.from===56);
        const label=document.createElement('span');label.className='pin';label.textContent='兔子洞落点';
        place(label,landing.x,landing.y);
    }
    if(id===82){
        const landing=arrivals.get(id).find(a=>a.from===79&&!m.e.some(e=>
            e[2]===79&&Math.abs(e[0]-a.x)+Math.abs(e[1]-a.y)<=1));
        if(landing){
            const label=document.createElement('span');label.className='pin';label.textContent='断桥落点';
            place(label,landing.x,landing.y);
        }
    }
    for (const [x,y] of m.f) {
            const fire = document.createElement('button');
            fire.className = 'firepin';
            fire.textContent = '🔥';
            fire.title = '篝火';
            fire.setAttribute('aria-label',fire.title);
            fire.onclick = ev => {
                
                ev.stopPropagation();
                showPinDetail(fire,fire.title);
            };
            place(fire,x,y);
    }
    for(const [x,y,name] of m.routeItems||[]){
        const label=document.createElement('span');label.className='pin itemName';
        label.textContent=name;place(label,x,y);
    }
    if(m.recollections){
        for(const [x,y,title,condition,portrait] of m.recollections){
            const button=document.createElement('button');button.className='recallSpot';
            const name=document.createElement('strong'),hint=document.createElement('span');
            const image=document.createElement('img');image.src=m.recallSprites[portrait];image.alt='';
            name.textContent=title;hint.textContent=condition;button.append(image,name,hint);
            button.onclick=ev=>{ev.stopPropagation();showPinDetail(ev.currentTarget,title+' · '+condition)};
            place(button,x,y);
        }
        const [x,y,title,condition]=m.recallUnlock;
        const button=document.createElement('button');button.className='pin shelfName';button.textContent=title;
        button.title=condition;button.onclick=ev=>{ev.stopPropagation();showPinDetail(ev.currentTarget,condition)};
        place(button,x,y);
    }
    npcMarkers();showInteraction();
    renderRoutes();
    if (loc) {
        const dot = document.createElement('span');
        dot.className = 'loc';
        dot.title = npcName(loc[2]);
        place(dot,...loc);
    }
    positionExitLabels();
}

const people = data.npcs;
const shortNames={
    '黑之教戒师艾兹瓦尔德':'艾兹瓦尔德','锻冶屋罗布斯':'罗布斯','流浪骑士伊兹':'伊兹',
    '黑之审判者海因':'海因','圣女护卫奥克斯':'奥克斯','圣女护卫贝利欧尔':'贝利欧尔',
    '阴月骑士奥因提乌斯':'奥因提乌斯','兔骑士鲁米拉吉':'鲁米拉吉','龟骑士阿达曼':'阿达曼',
    '作孽的多纳鲁':'多纳鲁','守护的卡梅雷欧':'卡梅雷欧','王者辛巴达':'辛巴达',
    '傀儡匹诺曹':'匹诺曹','豌豆杰克':'杰克','魔人阿拉丁':'阿拉丁','色情魔萨提洛斯':'萨提洛斯',
    '美女拉・贝尔':'拉・贝尔','野兽亚当':'亚当','挚爱的白龙西拉斯':'西拉斯',
    '尸龙海尔凯撒':'海尔凯撒','腐龙海尔凯撒':'海尔凯撒','飞龙海尔凯撒':'海尔凯撒',
    '圣兽贞德':'贞德','被诅咒的哥哥韩塞尔':'韩塞尔','被诅咒的妹妹格蕾特':'格蕾特',
    '吞噬活祭的帕托拉休':'帕托拉休','太阳骑士阿波罗':'阿波罗','北风骑士玻瑞阿斯':'玻瑞阿斯',
    '黑龙卡拉米尔':'卡拉米尔','神的失败作莉莉丝':'莉莉丝','尘主克拉肯':'克拉肯',
    '怪兽贝希摩斯':'贝希摩斯','拷问女王伊丽莎白·巴托丽':'伊丽莎白·巴托丽',
    '钢铁汉斯':'汉斯','长发公主':'拉普谢尔'
};
const formNames={'尸龙海尔凯撒':'尸龙','腐龙海尔凯撒':'腐龙','飞龙海尔凯撒':'飞龙',
    '圣兽贞德':'圣兽','被诅咒的哥哥韩塞尔':'受诅咒','被诅咒的妹妹格蕾特':'受诅咒'};
function npcName(name){return shortNames[name]||name}
function npcChoiceName(name){return npcName(name)+(formNames[name]?'（'+formNames[name]+'）':'')}
const npcNames = Object.keys(people).sort((a,b)=>npcChoiceName(a).localeCompare(npcChoiceName(b),'zh-Hans-CN'));
function npcDetail(kind,moving){
    return [['','接触或遭遇','剧情站位'][kind],moving?'会移动':''].filter(Boolean).join(' · ');
}
const visibleNpcs=new Map();
function landmarkDetail(name,scene,x,y){
    return people[name].landmarks?.find(p=>p[0]===scene&&p[1]===x&&p[2]===y)?.[3];
}
for(const [name,person] of Object.entries(people)){
    for(const point of person.points){
        const [scene,x,y,,,,door]=point;
        if(door||(person.points.length!==1&&!person.routeMaps.includes(scene)&&!landmarkDetail(name,scene,x,y)))continue;
        if(!visibleNpcs.has(scene))visibleNpcs.set(scene,[]);
        visibleNpcs.get(scene).push([name,point]);
    }
}
let selectedNpc = '';
function npcLookup(name) {
    const person=people[name];
    return [name,npcChoiceName(name),person.aliases,person.shop?'商人 商店':''].join(' ').normalize('NFKC').toLowerCase();
}
function npcFilter() {
    const query=$('npcFind').value.trim().normalize('NFKC').toLowerCase();
    const names=npcNames.filter(name=>npcLookup(name).includes(query));
    const selector=$('npcChoice');
    selector.replaceChildren(new Option(names.length?'选择人物（'+names.length+'）':'没有匹配的人物',''));
    for(const name of names) selector.add(new Option(npcChoiceName(name),name));
    selectedNpc=names.includes(selectedNpc)?selectedNpc:(query && names.length===1?names[0]:'');
    selector.value=selectedNpc;
    npcLocations();
    if(m) buildExits();
}
function npcLocations(){
    const panel=$('npcPlaces');
    panel.replaceChildren();
    if(!selectedNpc)return;
    const spots=people[selectedNpc].points.slice().sort((a,b)=>Number(b[0]===id)-Number(a[0]===id)||rank.get(a[0])-rank.get(b[0])||a[3]-b[3]);
    for(const [scene,x,y,kind,moving,,door] of spots){
        const btn=document.createElement('button');
        const name=title(scene);
        btn.textContent=(scene===id?'本图 · ':'')+name+(door?' · '+door:'');
        const detail=document.createElement('small');
        detail.textContent=landmarkDetail(selectedNpc,scene,x,y)||(door?'人物在房内':npcDetail(kind,moving));
        if(detail.textContent)btn.append(detail);
        btn.onclick=()=>focusNpc(scene,x,y);
        panel.append(btn);
    }
}
function focusNpc(scene,x,y){
    const name=selectedNpc;
    openMap(scene,[x,y,name]);
    if(zoom<.65) scale(.8);
    const bounds=stage.getBoundingClientRect(),viewport=area.getBoundingClientRect();
    area.scrollBy(bounds.left+(x+.5)*bounds.width/m.w-viewport.left-area.clientWidth/2,
                  bounds.top+(y+.5)*bounds.height/m.h-viewport.top-area.clientHeight/2);
}
function teaPartyRabbits(list){
    for(const [name,description] of [
        ['提示谜题的兔子','它提醒你，班达斯奈奇的问题可以不回答。'],
        ['说出真相的兔子','选择「是」听它讲完秘密后，它会被杀死。']
    ]){
        const [scene,x,y]=people[name].points[0];
        const button=document.createElement('button'),note=document.createElement('small');
        button.textContent=name;
        note.textContent=(name==='提示谜题的兔子'?'茶会东侧':'茶会西侧')+' · '+description;
        button.append(note);
        button.onclick=()=>{
            $('npcFind').value=name;npcFilter();focusNpc(scene,x,y);
        };
        list.append(button);
    }
}
const sharedForms=new Map([[144,['玛丽安娜','吸血鬼']],[19,['会说话的花','退废主']],[37,['黄金之鹅','古兹']]]);
function npcMarkers(){
    const markers=(visibleNpcs.get(id)||[]).filter(([name])=>name!==selectedNpc);
    if(selectedNpc)for(const point of people[selectedNpc].points){
        if(point[0]===id)markers.push([selectedNpc,point]);
    }
    for(const [name,[,x,y,kind,moving,sprite,door]] of markers){
        const shared=sharedForms.get(id);
        const sharedSpot=shared?.includes(name);
        if(sharedSpot && name!==(shared.includes(selectedNpc)?selectedNpc:shared[0]))continue;
        const label=sharedSpot&&id!==19?[name,shared.find(n=>n!==name)].map(npcName).join(' · '):npcName(name);
        const pin=document.createElement('button');
        pin.className='npcPin';
        if(loc && loc[2]===name && loc[0]===x && loc[1]===y) pin.classList.add('chosenNpc');
        const image=document.createElement('img');
        image.src=data.sprites[sprite];
        image.alt='';
        image.draggable=false;
        pin.append(image);
        pin.title=[label,door?door+'，人物在房内':npcDetail(kind,moving)].filter(Boolean).join(' · ');
        pin.setAttribute('aria-label',pin.title);
        pin.onclick=ev=>{ev.stopPropagation();showPinDetail(ev.currentTarget,pin.title);};
        place(pin,x,y);
        const caption=document.createElement('span');
        caption.className='pin npcName';
        caption.textContent=label;
        place(caption,x,y);
    }
}
$('npcFind').oninput=npcFilter;
$('npcChoice').onchange=()=>{selectedNpc=$('npcChoice').value;npcLocations();buildExits();};
$('npcFind').onkeydown=e=>{if(e.key==='Enter' && $('npcChoice').options.length>1){
    $('npcChoice').selectedIndex=1;$('npcChoice').onchange();
}};
npcFilter();

$('areas').onchange=e=>openRegion(e.target.value);
$('maps').onchange=e=>openMap(+e.target.value);
$('back').onclick=()=>{const [i,p,o]=historyStack.pop();openMap(i,p,false,o)};
$('fit').onclick=()=>{fit=true;size();area.scrollTo(0,0)};
$('plus').onclick=()=>scale(zoom*1.35);
$('out').onclick=()=>scale(zoom/1.35);

const overviewWidth=1280,overviewHeight=870;
const overviewNodes=[
 ['圣森',10,640,434],['被监视的河流',85,365,434],['小红帽的家',1,110,434],
 ['遗弃之森',18,640,368],['魔女之家',21,640,302],['下水道',25,640,236],['淫腐街',27,640,170],
 ['艾翁之砦',6,640,104],['失落帝国',95,640,38],['旧淫腐街',134,410,170],
 ['尘海',115,890,368],['魔宴的森庭',136,890,266],
 ['贝希摩斯牧场',37,1166,434],['雅各布废坑',41,1166,336],['葛索的高塔',64,1166,238],
 ['赫莎沙漠',49,1166,514],['白雪城',48,1166,620],['不思议之国',83,1166,728],
 ['墓地街爱丽库谢尔',67,640,547],['威尔海姆大桥',79,365,547],['秘密的花园',81,110,547],
 ['污秽之沼',82,365,682],['地底世界昆·岩',8,365,826],
 ['骸骨迷宫',70,890,547],['水没都市亚特兰蒂斯',72,890,682]
];
const defaultScene=new Map(overviewNodes.map(([name,scene])=>[name,scene]));
function openRegion(name){openMap(defaultScene.get(name));}
const overviewBranches=[
 ['圣森','被监视的河流','小红帽的家'],
 ['圣森','遗弃之森','魔女之家','下水道','淫腐街','艾翁之砦','失落帝国'],
 ['淫腐街','旧淫腐街'],['遗弃之森','尘海','魔宴的森庭'],
 ['圣森','贝希摩斯牧场','雅各布废坑','葛索的高塔'],
 ['贝希摩斯牧场','赫莎沙漠','白雪城','不思议之国'],
 ['圣森','墓地街爱丽库谢尔','威尔海姆大桥','秘密的花园'],
 ['威尔海姆大桥','污秽之沼','地底世界昆·岩'],
 ['墓地街爱丽库谢尔','骸骨迷宫','水没都市亚特兰蒂斯']
];
let overviewZoom=null;
function sizeOverview(){
    if(!document.body.classList.contains('isOverview'))return;
    const view=$('overviewScroll');
    const scale=overviewZoom??Math.min(1,view.clientWidth/overviewWidth,view.clientHeight/overviewHeight);
    $('overviewSheet').style.width=overviewWidth*scale+'px';
    $('overviewZoom').textContent=overviewZoom===null?'放大':'适应窗口';
}
function setOverview(visible){
    document.body.classList.toggle('isOverview',visible);
    $('overviewOpen').setAttribute('aria-pressed',String(visible));
    if(!visible)return;
    sizeOverview();
    for(const button of $('regionTargets').children){
        button.setAttribute('aria-current',String(button.dataset.area===$('areas').value));
    }
}
function setupOverview(){
    const positions=new Map(),connections=[];
    for(const [name,scene,x,y] of overviewNodes){
        positions.set(name,{x,y});
        const button=document.createElement('button');
        button.type='button';button.className='regionTarget';button.dataset.area=name;button.setAttribute('aria-label',name);
        button.style.left=x/overviewWidth*100+'%';button.style.top=y/overviewHeight*100+'%';
        const image=document.createElement('img');image.src=artSource('区域缩略图/'+code(scene)+'.webp');image.alt='';image.draggable=false;
        const label=document.createElement('span');label.textContent=name;
        button.append(image,label);
        button.onclick=()=>{openRegion(name);$('maps').focus({preventScroll:true})};
        const highlight=on=>{for(const [from,to,path] of connections){
            if(from===name||to===name)path.classList.toggle('linked',on);
        }};
        button.onpointerenter=button.onfocus=()=>highlight(true);
        button.onpointerleave=button.onblur=()=>highlight(false);
        $('regionTargets').append(button);
    }
    for(const branch of overviewBranches)for(let i=1;i<branch.length;i++){
        const from=branch[i-1],to=branch[i],a=positions.get(from),b=positions.get(to);
        const middleX=(a.x+b.x)/2;
        const bend=a.x!==b.x && a.y!==b.y?' L'+middleX+' '+a.y+' L'+middleX+' '+b.y:'';
        const d='M'+a.x+' '+a.y+bend+' L'+b.x+' '+b.y;
        const path=svgItem($('worldLinks'),'path',{d,'data-from':from,'data-to':to});
        connections.push([from,to,path]);
    }
    $('overviewOpen').onclick=()=>setOverview(true);
    $('overviewZoom').onclick=()=>{
        overviewZoom=overviewZoom===null?Math.max(1,$('overviewSheet').getBoundingClientRect().width/overviewWidth*1.35):null;
        sizeOverview();
    };
    new ResizeObserver(sizeOverview).observe($('overviewScroll'));
}


function setSidebarClosed(closed){
        document.body.classList.toggle('sidebarClosed',closed);
        $('sidebar').hidden=closed;
        for(const toggle of document.querySelectorAll('.sidebarToggle')){
            toggle.setAttribute('aria-expanded',String(!closed));
            toggle.title=closed?'展开侧栏':'收起侧栏';
            toggle.setAttribute('aria-label',toggle.title);
        }
}
for(const button of document.querySelectorAll('.sidebarToggle')){
    button.onclick=()=>setSidebarClosed(!$('sidebar').hidden);
}
function zoomView(view,factor,anchor){
    if(view===area){scale(zoom*factor,anchor);return}
    const sheet=$('overviewSheet');
    const value=sheet.getBoundingClientRect().width/overviewWidth*factor;
    zoomAround(view,sheet,()=>{overviewZoom=Math.max(.1,Math.min(4,value));sizeOverview()},anchor);
}
for(const button of document.querySelectorAll('[data-actual-size]')){
    button.onclick=()=>{
        if(activeViewport()===area){scale(1);return}
        zoomAround($('overviewScroll'),$('overviewSheet'),()=>{overviewZoom=1;sizeOverview()});
    };
}
function activeViewport(){return document.body.classList.contains('isOverview')?$('overviewScroll'):area}
document.addEventListener('wheel',ev=>{
    const view=activeViewport(),inside=view.contains(ev.target);
    if($('shelfRoom').open||(!inside&&!ev.ctrlKey&&!ev.metaKey)||!ev.deltaY)return;
    ev.preventDefault();
    const unit=ev.deltaMode===1?16:ev.deltaMode===2?view.clientHeight:1;
    const delta=Math.max(-240,Math.min(240,ev.deltaY*unit));
    zoomView(view,Math.exp(-delta*(ev.ctrlKey ? .008 : .0025)),inside?[ev.clientX,ev.clientY]:null);
},{passive:false});
document.addEventListener('keydown',ev=>{
    if(!(ev.ctrlKey||ev.metaKey)||ev.altKey||$('shelfRoom').open)return;
    const view=activeViewport();
    if(['+','=','-','_'].includes(ev.key)){
        ev.preventDefault();zoomView(view,ev.key==='-'||ev.key==='_'?1/1.35:1.35);
    }else if(ev.key==='0'){
        ev.preventDefault();
        if(view===area)$('fit').click();else{overviewZoom=null;sizeOverview()}
    }
});
function enableMapGestures(view){
    const pointers=new Map();
    let moved=false,startX=0,startY=0;
    function gesture(){
        const [a,b]=pointers.values();
        if(!b)return {x:a.x,y:a.y,distance:0};
        return {x:(a.x+b.x)/2,y:(a.y+b.y)/2,distance:Math.hypot(a.x-b.x,a.y-b.y)};
    }
    view.addEventListener('pointerdown',ev=>{
        if(ev.button!==0)return;
        if(!pointers.size){moved=false;startX=ev.clientX;startY=ev.clientY}
        pointers.set(ev.pointerId,{x:ev.clientX,y:ev.clientY});
        if(pointers.size>1)moved=true;
        ev.target.setPointerCapture(ev.pointerId);
    });
    view.addEventListener('pointermove',ev=>{
        if(!pointers.has(ev.pointerId))return;
        const prev=gesture();
        if(!moved&&Math.hypot(ev.clientX-startX,ev.clientY-startY)<4)return;
        moved=true;$('pinDetail').hidePopover();
        pointers.set(ev.pointerId,{x:ev.clientX,y:ev.clientY});
        const next=gesture();
        if(prev.distance>0&&next.distance>0)zoomView(view,next.distance/prev.distance,[prev.x,prev.y]);
        view.scrollBy(prev.x-next.x,prev.y-next.y);
    });
    for(const type of ['pointerup','pointercancel','lostpointercapture']){
        view.addEventListener(type,ev=>pointers.delete(ev.pointerId));
    }
    view.addEventListener('dragstart',ev=>ev.preventDefault());
    view.addEventListener('click',ev=>{
        if(moved&&ev.detail){ev.preventDefault();ev.stopImmediatePropagation()}
    },true);
}
enableMapGestures(area);enableMapGestures($('overviewScroll'));
setupOverview();
new ResizeObserver(()=>{if(m&&!document.body.classList.contains('isOverview'))size()}).observe(area);openMap(10,null,false,null,true);

if(location.hostname.endsWith('.github.io')){
    const owner=location.hostname.split('.')[0];
    const [project]=location.pathname.split('/').filter(Boolean);
    const repo=project&&project!=='index.html'?project:location.hostname;
    const source=document.getElementById('sourceLink');
    source.href='https://github.com/'+owner+'/'+encodeURIComponent(decodeURIComponent(repo));
    source.hidden=false;
}
