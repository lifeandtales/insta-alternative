export const storyFontStyles = Object.freeze([
    {id:'sans',label:'Sans',family:'Inter, sans-serif',weight:400,style:'normal',spacing:0,transform:'none'},
    {id:'serif',label:'Serif',family:'Georgia, serif',weight:400,style:'normal',spacing:0,transform:'none'},
    {id:'mono',label:'Mono',family:'ui-monospace, SFMono-Regular, Menlo, monospace',weight:400,style:'normal',spacing:0,transform:'none'},
    {id:'rounded',label:'Rounded',family:'ui-rounded, system-ui, sans-serif',weight:500,style:'normal',spacing:0,transform:'none'},
    {id:'classic',label:'Classic',family:'Georgia, serif',weight:700,style:'normal',spacing:0,transform:'none'},
    {id:'elegant',label:'Elegant',family:'Georgia, serif',weight:400,style:'italic',spacing:0,transform:'none'},
    {id:'bold',label:'Bold',family:'Inter, sans-serif',weight:800,style:'normal',spacing:0,transform:'none'},
    {id:'italic',label:'Italic',family:'Inter, sans-serif',weight:400,style:'italic',spacing:0,transform:'none'},
    {id:'bold-italic',label:'Bold italic',family:'Inter, sans-serif',weight:700,style:'italic',spacing:0,transform:'none'},
    {id:'wide',label:'Wide',family:'Inter, sans-serif',weight:500,style:'normal',spacing:.09,transform:'none'},
    {id:'condensed',label:'Condensed',family:'Inter, sans-serif',weight:700,style:'normal',spacing:-.035,transform:'uppercase'},
    {id:'typewriter',label:'Typewriter',family:'ui-monospace, SFMono-Regular, Menlo, monospace',weight:600,style:'normal',spacing:.035,transform:'none'},
    {id:'caps',label:'All caps',family:'Inter, sans-serif',weight:600,style:'normal',spacing:.025,transform:'uppercase'},
    {id:'script',label:'Script',family:'cursive',weight:400,style:'normal',spacing:0,transform:'none'},
    {id:'display',label:'Display',family:'fantasy',weight:700,style:'normal',spacing:0,transform:'none'}
]);

const byId=new Map(storyFontStyles.map(style=>[style.id,style]));
export function getStoryFontStyle(id='sans'){
    return byId.get(id)||byId.get('sans');
}
export function transformStoryText(text,style){
    const value=String(text??'');
    if(style.transform==='uppercase')return value.toLocaleUpperCase();
    if(style.transform==='lowercase')return value.toLocaleLowerCase();
    return value;
}
