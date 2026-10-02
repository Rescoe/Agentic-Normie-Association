/**
 * previewShim.ts — mode « aperçu muet » des œuvres génératives, pour les VIGNETTES de la galerie (?preview=1).
 *
 * Problème : un sketch p5.sound attend un clic pour démarrer l'audio (politique d'autoplay des navigateurs) et, sans lui,
 * reste sur un écran vide ou rouge. Une vignette ne doit ni attendre un clic ni jamais émettre de son.
 *
 * Le script ci-dessous est injecté dans le <head> AVANT toute bibliothèque, uniquement quand la route est appelée avec
 * ?preview=1 (l'œuvre on-chain n'est jamais modifiée ; la vue plein écran et le certificat restent intacts) :
 *   1. SILENCE GARANTI : la destination audio du contexte est remplacée par un gain à 0 — même si un clic démarre réellement
 *      le contexte, rien n'est audible.
 *   2. DÉMARRAGE SANS GESTE : un AudioContext non démarré (sans clic) se déclare « running » et resume() ne bloque plus, donc le
 *      sketch ne reste pas à attendre.
 *   3. SPECTRE DE SUBSTITUTION : quand le signal réel d'un AnalyserNode (p5.FFT, p5.Amplitude…) est SILENCIEUX — contexte suspendu,
 *      ou sons jamais démarrés faute de clic — il renvoie un spectre / une onde SYNTHÉTIQUES déterministes (pulsation + grain),
 *      pour que l'aperçu soit vivant. Ce n'est PAS le son de l'œuvre : c'est une vignette. Dès qu'un vrai signal existe, les vraies
 *      données reviennent (toujours muettes).
 *   4. ÉCONOMIE : hors de l'écran, le sketch est mis en pause (noLoop) et repris à l'entrée dans le viewport.
 * Tout est entouré de try/catch : un échec du shim ne casse jamais l'œuvre.
 */

export const PREVIEW_SHIM_SCRIPT = `(function(){
try{
  var started = performance.now();
  var Base = window.BaseAudioContext || window.AudioContext || window.webkitAudioContext;
  var AC = window.AudioContext || window.webkitAudioContext;
  if (Base) {
    var proto = Base.prototype;
    var stateDesc = Object.getOwnPropertyDescriptor(proto, 'state');

    // 1. Silence : toute connexion vers la sortie aboutit sur un gain à 0
    var destDesc = Object.getOwnPropertyDescriptor(proto, 'destination');
    if (destDesc && destDesc.get) {
      var muted = new WeakMap();
      Object.defineProperty(proto, 'destination', { configurable: true, get: function(){
        var m = muted.get(this);
        if (!m) { var real = destDesc.get.call(this); m = this.createGain(); m.gain.value = 0; m.connect(real); muted.set(this, m); }
        return m;
      }});
    }

    // 2. Démarrage sans geste : « running » affiché, resume() sans blocage
    if (stateDesc && stateDesc.get) {
      Object.defineProperty(proto, 'state', { configurable: true, get: function(){ var s = stateDesc.get.call(this); return s === 'suspended' ? 'running' : s; } });
    }
    if (AC && AC.prototype.resume) {
      var realResume = AC.prototype.resume;
      AC.prototype.resume = function(){ try { realResume.call(this).catch(function(){}); } catch(e) {} return Promise.resolve(); };
    }

    // 3. Spectre / onde de substitution quand le contexte est réellement suspendu
    var noise = function(i, t){ var x = Math.sin(i * 12.9898 + Math.floor(t * 12) * 78.233) * 43758.5453; return x - Math.floor(x); };
    var level = function(i, n, t){
      var pos = i / Math.max(1, n - 1);
      var beat = Math.pow(Math.max(0, Math.sin(t * Math.PI * 4)), 4);
      var tone = 0.18 + 0.5 * beat * Math.pow(1 - pos, 1.4) + 0.22 * Math.pow(1 - pos, 2.2) * (0.6 + 0.4 * Math.sin(t * 1.7 + i * 0.35));
      return Math.max(0, Math.min(1, tone + 0.14 * (noise(i, t) - 0.5)));
    };
    var wave = function(i, n, t){ return 0.55 * Math.sin(i / n * Math.PI * 8 + t * 6) * (0.4 + 0.6 * Math.pow(Math.max(0, Math.sin(t * Math.PI * 4)), 2)) + 0.12 * (noise(i, t) - 0.5); };
    var patch = function(name, fill, silent){
      var orig = AnalyserNode.prototype[name];
      if (!orig) return;
      AnalyserNode.prototype[name] = function(arr){
        orig.call(this, arr);
        var n = arr.length, quiet = true;
        for (var k = 0; k < n; k++) { if (!silent(arr[k])) { quiet = false; break; } }
        if (!quiet) return;
        var t = (performance.now() - started) / 1000;
        for (var i = 0; i < n; i++) arr[i] = fill(i, n, t);
      };
    };
    patch('getByteFrequencyData',   function(i, n, t){ return Math.round(255 * level(i, n, t)); }, function(v){ return v === 0; });
    patch('getFloatFrequencyData',  function(i, n, t){ return -100 + 70 * level(i, n, t); },       function(v){ return !(v > -99); });
    patch('getByteTimeDomainData',  function(i, n, t){ return Math.round(128 + 110 * wave(i, n, t)); }, function(v){ return v === 128; });
    patch('getFloatTimeDomainData', function(i, n, t){ return wave(i, n, t); },                    function(v){ return v === 0; });
  }

  // 4. Pause hors écran (le viewport de référence est celui de la page parente)
  if ('IntersectionObserver' in window) {
    new IntersectionObserver(function(entries){
      var visible = entries[entries.length - 1].isIntersecting;
      try { if (visible) { if (typeof window.loop === 'function') window.loop(); } else if (typeof window.noLoop === 'function') window.noLoop(); } catch(e) {}
    }).observe(document.documentElement);
  }
}catch(e){}
})();`;

/** Insère le shim juste après <head> (avant toute bibliothèque) ; sans <head>, en tête de document. */
export function injectPreviewShim(html: string): string {
  const tag = `<script>${PREVIEW_SHIM_SCRIPT}</script>`;
  const head = html.match(/<head[^>]*>/i);
  if (head && head.index !== undefined) {
    const at = head.index + head[0].length;
    return html.slice(0, at) + tag + html.slice(at);
  }
  const root = html.match(/<html[^>]*>/i);
  if (root && root.index !== undefined) {
    const at = root.index + root[0].length;
    return html.slice(0, at) + `<head>${tag}</head>` + html.slice(at);
  }
  return tag + html;
}
