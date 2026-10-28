import sharp from 'sharp';

/** Model transport only; cached originals and QQ sends retain their source bytes. */
export async function modelImage(bytes:Uint8Array,mime:string):Promise<{bytes:Uint8Array;mime:string}> {
  if(mime==='image/gif'||bytes.byteLength<=512*1024)return {bytes,mime};
  const input=sharp(bytes,{limitInputPixels:100_000_000,failOn:'error'}),metadata=await input.metadata();
  if(bytes.byteLength<=4*1024*1024&&(metadata.width??0)<=1568&&(metadata.height??0)<=1568)return {bytes,mime};
  const output=await input.rotate().resize({width:1568,height:1568,fit:'inside',withoutEnlargement:true}).flatten({background:'#ffffff'}).jpeg({quality:85}).toBuffer();
  return {bytes:output,mime:'image/jpeg'};
}
export async function firstGifFrame(url:string):Promise<string|undefined>{
  if(!url.startsWith('data:image/gif;base64,'))return;
  const bytes=Buffer.from(url.slice(url.indexOf(',')+1),'base64');
  const frame=await sharp(bytes,{animated:false,limitInputPixels:100_000_000}).resize({width:1568,height:1568,fit:'inside',withoutEnlargement:true}).png().toBuffer();
  return `data:image/png;base64,${frame.toString('base64')}`;
}
