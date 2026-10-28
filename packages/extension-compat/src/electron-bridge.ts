import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {EventEmitter} from 'node:events';
import type {HtmlRenderer,RenderSurface} from '@qq-harness/domain';
export function electronBridge(options:{renderer:()=>HtmlRenderer;signal:()=>AbortSignal;roots:string[];fetch:(url:string,init?:RequestInit)=>Promise<Response>;own:(close:()=>Promise<void>)=>(()=>void)}){
 class BrowserWindow{
  private surface?:Promise<RenderSurface>;private destroyed=false;private dimensions:[number,number];private unown?:()=>void;
  readonly webContents=new EventEmitter() as EventEmitter&{executeJavaScript:(script:string)=>Promise<unknown>;capturePage:()=>Promise<{toPNG():Buffer;getSize():{width:number;height:number};isEmpty():boolean}>};
  constructor(private settings:{width?:number;height?:number;backgroundColor?:string}={}){
   this.dimensions=[settings.width??800,settings.height??220];
   this.webContents.executeJavaScript=async script=>(await this.page()).evaluate(script);
   this.webContents.capturePage=async()=>{const surface=await this.page();await surface.resize(...this.dimensions);const bytes=Buffer.from(await surface.screenshot()),[width,height]=this.dimensions;return {toPNG:()=>bytes,getSize:()=>({width,height}),isEmpty:()=>bytes.length===0};};
   this.unown=options.own(async()=>{this.destroyed=true;await(await this.surface)?.close();});
  }
  private async page(){if(this.destroyed)throw new Error('面板实例已关闭');this.surface??=options.renderer().create({width:this.dimensions[0],height:this.dimensions[1],background:this.settings.backgroundColor},options.signal());const surface=await this.surface;await surface.resize(...this.dimensions);return surface;}
  async loadURL(url:string){if(!url.startsWith('data:text/html'))throw new Error('面板只接受本地生成的 HTML');const comma=url.indexOf(',');if(comma<0)throw new Error('HTML 地址无效');const html=/;base64/i.test(url.slice(0,comma))?Buffer.from(url.slice(comma+1),'base64').toString('utf8'):decodeURIComponent(url.slice(comma+1));await(await this.page()).load(html);this.webContents.emit('paint');}
  async loadFile(file:string){const actual=fs.realpathSync(file),allowed=[...options.roots,os.tmpdir()].some(root=>{const rel=path.relative(fs.realpathSync(root),actual);return rel!==''&&!rel.startsWith('..')&&!path.isAbsolute(rel);});if(!allowed||!['.html','.htm'].includes(path.extname(actual).toLowerCase()))throw new Error('面板 HTML 文件不在允许目录');await(await this.page()).load(fs.readFileSync(actual,'utf8'));this.webContents.emit('paint');}
  setContentSize(width:number,height:number){this.dimensions=[width,height];}
  setSize(width:number,height:number){this.setContentSize(width,height);}
  getContentSize(){return [...this.dimensions];}
  isDestroyed(){return this.destroyed;}
  destroy(){if(this.destroyed)return;this.destroyed=true;if(this.surface)void this.surface.then(surface=>surface.close()).catch(()=>{}).finally(()=>this.unown?.());else this.unown?.();this.webContents.removeAllListeners();}
  close(){this.destroy();}
 }
 return {BrowserWindow,net:{fetch:options.fetch}};
}
