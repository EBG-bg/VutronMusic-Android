import { onBeforeUnmount, watch, type Ref } from 'vue'

/** Isolate a teleported sheet while preserving nested pickers and prior styles. */
export function useModalIsolation(panel: Ref<HTMLElement | undefined>, open: () => boolean = () => true) {
  let layer:HTMLElement|undefined
  let isolated:{element:HTMLElement;inert:boolean}[]=[]
  let scroll:{x:number;y:number;styles:[HTMLElement,string,string,string][]}|undefined
  function release(){
    for(const item of isolated)item.element.inert=item.inert
    isolated=[];layer=undefined
    if(!scroll)return
    const previous=scroll;scroll=undefined
    for(const [element,property,value,priority]of previous.styles){if(value)element.style.setProperty(property,value,priority);else element.style.removeProperty(property)}
    window.scrollTo({left:previous.x,top:previous.y,behavior:'instant'})
  }
  watch(()=>open()&&panel.value?panel.value.parentElement:undefined,value=>{
    if(value===layer)return
    release();if(!value)return
    layer=value;scroll={x:window.scrollX,y:window.scrollY,styles:[]}
    for(const element of [document.documentElement,document.body])for(const property of ['overflow','overscroll-behavior']){
      scroll.styles.push([element,property,element.style.getPropertyValue(property),element.style.getPropertyPriority(property)])
      element.style.setProperty(property,property==='overflow'?'hidden':'none')
    }
    for(const element of Array.from(document.body.children))if(element instanceof HTMLElement&&element!==value&&!element.contains(value)){
      isolated.push({element,inert:element.inert});element.inert=true
    }
  },{flush:'post'})
  onBeforeUnmount(release)
}
