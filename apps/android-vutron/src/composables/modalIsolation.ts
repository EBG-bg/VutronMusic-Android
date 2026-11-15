import { onBeforeUnmount, watch, type Ref } from 'vue'

type Owner = { layer?: HTMLElement }
const owners: Owner[] = []
const backgrounds = new Map<HTMLElement, boolean>()
let scroll:{x:number;y:number;styles:[HTMLElement,string,string,string][]}|undefined

function syncIsolation() {
  const top = owners.at(-1)?.layer
  if (!top) {
    for (const [element, inert] of backgrounds) element.inert = inert
    backgrounds.clear()
    if (!scroll) return
    const previous=scroll;scroll=undefined
    for(const [element,property,value,priority]of previous.styles){if(value)element.style.setProperty(property,value,priority);else element.style.removeProperty(property)}
    window.scrollTo({left:previous.x,top:previous.y,behavior:'instant'})
    return
  }
  if (!scroll) {
    scroll={x:window.scrollX,y:window.scrollY,styles:[]}
    for(const element of [document.documentElement,document.body])for(const property of ['overflow','overscroll-behavior']){
      scroll.styles.push([element,property,element.style.getPropertyValue(property),element.style.getPropertyPriority(property)])
      element.style.setProperty(property,property==='overflow'?'hidden':'none')
    }
  }
  for (const element of Array.from(document.body.children)) if (element instanceof HTMLElement) {
    if (!backgrounds.has(element)) backgrounds.set(element, element.inert)
    element.inert = backgrounds.get(element)! || !element.hasAttribute('data-ui-notification') && element !== top && !element.contains(top)
  }
}

/** The last open sheet owns isolation; closing a parent cannot unlock its child. */
export function useModalIsolation(panel: Ref<HTMLElement | undefined>, open: () => boolean = () => true) {
  const owner:Owner = {}
  function release() {
    const index=owners.indexOf(owner)
    if(index<0)return
    owners.splice(index,1);owner.layer=undefined;syncIsolation()
  }
  watch(()=>open()&&panel.value?panel.value.parentElement:undefined,value=>{
    if(value===owner.layer)return
    const index=owners.indexOf(owner)
    if(index>=0)owners.splice(index,1)
    owner.layer=value||undefined
    if(value)owners.push(owner)
    syncIsolation()
  },{flush:'post'})
  onBeforeUnmount(release)
}
