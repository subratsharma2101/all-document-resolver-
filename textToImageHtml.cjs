// Escape a value for safe inlining inside a <script> as a JSON literal. Mirrors the
// hardening used by the PDF viewer so page content cannot break out of the script.
// The line/paragraph separators are built from char codes so this source file never
// contains those literal characters (they would break the JS parser).
const LINE_SEP = new RegExp(String.fromCharCode(0x2028), 'g');
const PARA_SEP = new RegExp(String.fromCharCode(0x2029), 'g');

function scriptValue(value) {
  return JSON.stringify(value)
    .replace(/</g, '\\u003c')
    .replace(LINE_SEP, '\\u2028')
    .replace(PARA_SEP, '\\u2029');
}

const DEFAULTS = { fontSize: 24, padding: 40, bg: '#ffffff', fg: '#12151c', maxWidth: 1080 };

// Build an isolated HTML document that draws `text` onto a canvas and posts the
// resulting PNG (base64, no data-URI prefix) back to React Native. No network access.
function buildTextImageHtml(text, options = {}) {
  const o = { ...DEFAULTS, ...options };
  const bg = /^#[0-9a-fA-F]{3,8}$/.test(o.bg) ? o.bg : '#ffffff';
  const fg = /^#[0-9a-fA-F]{3,8}$/.test(o.fg) ? o.fg : '#12151c';
  return `<!DOCTYPE html><html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:;">
<style>html,body{margin:0;background:${bg}}</style>
</head><body>
<script>
(function(){
  var post=function(m){window.ReactNativeWebView&&window.ReactNativeWebView.postMessage(JSON.stringify(m));};
  try{
    var text=${scriptValue(String(text))};
    if(text.length>20000)throw new Error('Too much text for one image. Save as PDF or split the text.');
    var fontSize=${Math.max(8, Math.min(72, Number(o.fontSize) || 24))};
    var padding=${Math.max(0, Math.min(100, Number(o.padding) || 40))};
    var maxWidth=${Math.max(320, Math.min(2048, Number(o.maxWidth) || 1080))};
    var bg=${scriptValue(bg)};
    var fg=${scriptValue(fg)};
    var ratio=Math.min(window.devicePixelRatio||1,2);
    var measure=document.createElement('canvas').getContext('2d');
    var font=fontSize+'px system-ui,-apple-system,sans-serif';
    measure.font=font;
    var lineHeight=Math.round(fontSize*1.5);
    var contentWidth=maxWidth-padding*2;
    var lines=[];
    var paragraphs=text.replace(/\\r\\n?/g,'\\n').replace(/\\t/g,'    ').split('\\n');
    var segmenter=typeof Intl.Segmenter==='function'?new Intl.Segmenter(undefined,{granularity:'grapheme'}):null;
    for(var p=0;p<paragraphs.length;p++){
      var words=paragraphs[p].split(/(\\s+)/);
      var line='';
      for(var w=0;w<words.length;w++){
        var word=words[w];
        if(word==='')continue;
        var test=line+word;
        if(measure.measureText(test).width<=contentWidth){line=test;continue;}
        if(line){lines.push(line.replace(/\\s+$/,''));line='';}
        var rest=word.replace(/^\\s+/,'');
        var characters=segmenter?Array.from(segmenter.segment(rest),function(s){return s.segment;}):Array.from(rest);
        for(var c=0;c<characters.length;c++){
          if(line&&measure.measureText(line+characters[c]).width>contentWidth){lines.push(line);line='';}
          line+=characters[c];
        }
      }
      lines.push(line.replace(/\\s+$/,''));
    }
    var height=padding*2+Math.max(lineHeight,lines.length*lineHeight);
    if(height*ratio>8192||maxWidth*height*ratio*ratio>16000000)throw new Error('Text is too tall for one image. Save as PDF or split the text.');
    var canvas=document.createElement('canvas');
    canvas.width=Math.round(maxWidth*ratio);
    canvas.height=Math.round(height*ratio);
    var ctx=canvas.getContext('2d');
    ctx.scale(ratio,ratio);
    ctx.fillStyle=bg;ctx.fillRect(0,0,maxWidth,height);
    ctx.fillStyle=fg;ctx.textBaseline='top';ctx.font=font;
    for(var i=0;i<lines.length;i++){ctx.fillText(lines[i],padding,padding+i*lineHeight);}
    var url=canvas.toDataURL('image/png');
    if(!url.startsWith('data:image/png;base64,'))throw new Error('The device could not render this image. Use less text.');
    post({type:'png',base64:url.split(',')[1],width:canvas.width,height:canvas.height});
  }catch(e){post({type:'error',message:String(e&&e.message?e.message:e)});}
})();
</script></body></html>`;
}

module.exports = { buildTextImageHtml, scriptValue };
