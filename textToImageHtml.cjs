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
    var fontSize=${Number(o.fontSize) || 24};
    var padding=${Number(o.padding) || 40};
    var maxWidth=${Number(o.maxWidth) || 1080};
    var bg=${scriptValue(bg)};
    var fg=${scriptValue(fg)};
    var ratio=Math.min(window.devicePixelRatio||1,3);
    var measure=document.createElement('canvas').getContext('2d');
    var font=fontSize+'px system-ui,-apple-system,sans-serif';
    measure.font=font;
    var lineHeight=Math.round(fontSize*1.5);
    var contentWidth=maxWidth-padding*2;
    var lines=[];
    var paragraphs=text.replace(/\\r\\n?/g,'\\n').split('\\n');
    for(var p=0;p<paragraphs.length;p++){
      var words=paragraphs[p].split(/(\\s+)/);
      var line='';
      for(var w=0;w<words.length;w++){
        var word=words[w];
        if(word==='')continue;
        var test=line+word;
        if(measure.measureText(test).width<=contentWidth||line===''){
          if(line===''&&measure.measureText(word).width>contentWidth){
            var chunk='';
            for(var c=0;c<word.length;c++){
              if(measure.measureText(chunk+word[c]).width>contentWidth&&chunk!==''){lines.push(chunk);chunk=word[c];}
              else{chunk+=word[c];}
            }
            line=chunk;
          }else{line=test;}
        }else{lines.push(line.replace(/\\s+$/,''));line=word.replace(/^\\s+/,'');}
      }
      lines.push(line.replace(/\\s+$/,''));
    }
    var height=padding*2+Math.max(lineHeight,lines.length*lineHeight);
    var canvas=document.createElement('canvas');
    canvas.width=Math.round(maxWidth*ratio);
    canvas.height=Math.round(height*ratio);
    var ctx=canvas.getContext('2d');
    ctx.scale(ratio,ratio);
    ctx.fillStyle=bg;ctx.fillRect(0,0,maxWidth,height);
    ctx.fillStyle=fg;ctx.textBaseline='top';ctx.font=font;
    for(var i=0;i<lines.length;i++){ctx.fillText(lines[i],padding,padding+i*lineHeight);}
    var url=canvas.toDataURL('image/png');
    post({type:'png',base64:url.split(',')[1],width:canvas.width,height:canvas.height});
  }catch(e){post({type:'error',message:String(e&&e.message?e.message:e)});}
})();
</script></body></html>`;
}

module.exports = { buildTextImageHtml, scriptValue };
