import { deflateSync } from "node:zlib";

const GLYPHS = {
  A:"011101000110001111111000110001",B:"111101000111110100011000111110",C:"011111000010000100001000001111",D:"111101000110001100011000111110",E:"111111000011110100001000011111",F:"111111000011110100001000010000",G:"011111000010111100011000101111",H:"100011000111111100011000110001",I:"111110010000100001000010011111",J:"001110001000010000101001001100",K:"100011001011100100101000110001",L:"100001000010000100001000011111",M:"100011101110101100011000110001",N:"100011100110101100111000110001",O:"011101000110001100011000101110",P:"111101000110001111101000010000",Q:"011101000110001101011001001101",R:"111101000110001111101001010001",S:"011111000001110000011000111110",T:"111110010000100001000010000100",U:"100011000110001100011000101110",V:"100011000110001100010101000100",W:"100011000110101101011010101010",X:"100010101000100010101000110001",Y:"100010101000100001000010000100",Z:"111110001000100010001000011111",
  0:"011101000110011101011100101110",1:"001000110000100001000010001110",2:"011101000100001001100100011111",3:"111100000100110000011000111110",4:"000100011001010111110001000010",5:"111111000011110000011000111110",6:"011101000011110100011000101110",7:"111110001000100010000100001000",8:"011101000101110100011000101110",9:"011101000110001011110000101110",
  " ":"000000000000000000000000000000",XMARK:"000000000000100000000000000000",DASH:"000000000000000111110000000000",COLON:"000000010000000001000000000000"
};

let crcTable;
function crc32(buffer) { crcTable ??= Array.from({length:256},(_,n)=>{let c=n;for(let k=0;k<8;k++)c=(c&1)?0xedb88320^(c>>>1):c>>>1;return c>>>0;}); let c=0xffffffff; for(const byte of buffer)c=crcTable[(c^byte)&255]^(c>>>8); return (c^0xffffffff)>>>0; }
function chunk(type, data) { const name=Buffer.from(type); const length=Buffer.alloc(4); length.writeUInt32BE(data.length); const crc=Buffer.alloc(4); crc.writeUInt32BE(crc32(Buffer.concat([name,data]))); return Buffer.concat([length,name,data,crc]); }
function normalize(value) { return String(value ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g,"").toUpperCase().replace(/[^A-Z0-9 :\-]/g," ").replace(/\s+/g," ").trim(); }

export function renderSharePng(share) {
  const width=1200, height=630, pixels=Buffer.alloc(width*height*4);
  const fill=(x,y,w,h,[r,g,b,a=255])=>{for(let yy=Math.max(0,y);yy<Math.min(height,y+h);yy++)for(let xx=Math.max(0,x);xx<Math.min(width,x+w);xx++){const i=(yy*width+xx)*4;pixels[i]=r;pixels[i+1]=g;pixels[i+2]=b;pixels[i+3]=a;}};
  fill(0,0,width,height,[5,8,20]); fill(0,0,18,height,[199,255,24]); fill(780,0,420,height,[13,22,32]); fill(780,0,8,height,[199,255,24]);
  const draw=(text,x,y,scale,color,maxChars=32)=>{const clean=normalize(text).slice(0,maxChars); for(let c=0;c<clean.length;c++){const key=clean[c]==="-"?"DASH":clean[c]===":"?"COLON":clean[c]; const bits=GLYPHS[key]??GLYPHS[" "]; for(let row=0;row<6;row++)for(let col=0;col<5;col++)if(bits[row*5+col]==="1")fill(x+c*6*scale+col*scale,y+row*scale,scale,scale,color);}};
  const wrap=(text,limit=25)=>{const words=normalize(text).split(" ");const lines=[];let line="";for(const word of words){if(`${line} ${word}`.trim().length>limit){if(line)lines.push(line);line=word;}else line=`${line} ${word}`.trim();}if(line)lines.push(line);return lines.slice(0,3);};
  draw(`VIRA ${share.kind}`,72,68,5,[199,255,24],30);
  wrap(share.metadata.title,13).forEach((line,index)=>draw(line,72,160+index*72,8,[247,248,244],14));
  draw(share.payload?.homeTeam??"",820,210,5,[247,248,244],12); draw("X",820,285,5,[199,255,24],2); draw(share.payload?.awayTeam??"",820,350,5,[247,248,244],12);
  draw(share.destination.ctaLabel,72,560,4,[199,255,24],38);
  const scan=Buffer.alloc((width*4+1)*height); for(let y=0;y<height;y++){const offset=y*(width*4+1);scan[offset]=0;pixels.copy(scan,offset+1,y*width*4,(y+1)*width*4);}
  const header=Buffer.alloc(13);header.writeUInt32BE(width,0);header.writeUInt32BE(height,4);header[8]=8;header[9]=6;
  return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk("IHDR",header),chunk("IDAT",deflateSync(scan,{level:9})),chunk("IEND",Buffer.alloc(0))]);
}
