// Hindi pronunciation for the voice. The bundled phonemizer (espeak-ng)
// carries English data only, so Devanagari is converted to phonemes here,
// in the symbols Kokoro's Hindi voices were trained on (espeak-ng's Hindi
// output, with breathy aspiration written as plain aspiration because the
// model's vocabulary has no breathy mark).
//
// Hindi spelling is close to phonemic. The two things that are not written
// are handled by rule: the inherent vowel "a" (schwa) after consonants, which
// is dropped at the end of a word and between a vowel-consonant and a
// consonant-vowel pair (कमला: kəmlaː, not kəməlaː), and the nasal sign,
// which becomes a nasal consonant before a consonant and nasalises the vowel
// elsewhere.

const VOWELS = {
  'अ': 'ə', 'आ': 'aː', 'इ': 'ɪ', 'ई': 'iː', 'उ': 'ʊ', 'ऊ': 'uː', 'ऋ': 'ɾɪ', 'ए': 'eː', 'ऐ': 'ɛː', 'ओ': 'oː', 'औ': 'ɔː', 'ऑ': 'ɔ', 'ऍ': 'ɛ',
};
const MATRAS = {
  'ा': 'aː', 'ि': 'ɪ', 'ी': 'iː', 'ु': 'ʊ', 'ू': 'uː', 'ृ': 'ɾɪ', 'े': 'eː', 'ै': 'ɛː', 'ो': 'oː', 'ौ': 'ɔː', 'ॉ': 'ɔ', 'ॅ': 'ɛ',
};
// Consonant: phoneme and place of articulation (for the nasal sign).
const CONS = {
  'क': ['k', 'v'], 'ख': ['kʰ', 'v'], 'ग': ['ɡ', 'v'], 'घ': ['ɡʰ', 'v'], 'ङ': ['ŋ', 'v'],
  'च': ['ʧ', 'p'], 'छ': ['ʧʰ', 'p'], 'ज': ['ʤ', 'p'], 'झ': ['ʤʰ', 'p'], 'ञ': ['ɲ', 'p'],
  'ट': ['ʈ', 'r'], 'ठ': ['ʈʰ', 'r'], 'ड': ['ɖ', 'r'], 'ढ': ['ɖʰ', 'r'], 'ण': ['ɳ', 'r'],
  'त': ['t', 'd'], 'थ': ['tʰ', 'd'], 'द': ['d', 'd'], 'ध': ['dʰ', 'd'], 'न': ['n', 'd'],
  'प': ['p', 'l'], 'फ': ['pʰ', 'l'], 'ब': ['b', 'l'], 'भ': ['bʰ', 'l'], 'म': ['m', 'l'],
  'य': ['j', 'p'], 'र': ['ɾ', 'd'], 'ल': ['l', 'd'], 'व': ['ʋ', 'l'], 'श': ['ʃ', 'p'], 'ष': ['ʃ', 'r'], 'स': ['s', 'd'], 'ह': ['h', 'v'],
  'क़': ['q', 'v'], 'ख़': ['x', 'v'], 'ग़': ['ɣ', 'v'], 'ज़': ['z', 'd'], 'फ़': ['f', 'l'], 'ड़': ['ɽ', 'r'], 'ढ़': ['ɽʰ', 'r'], 'य़': ['j', 'p'],
};
const NASAL_FOR = { v: 'ŋ', p: 'ɲ', r: 'ɳ', d: 'n', l: 'm' };
const NUKTA = '़';
const VIRAMA = '्';
const ANUSVARA = 'ं';
const CANDRABINDU = 'ँ';
const VISARGA = 'ः';

export const DEVANAGARI = /[ऀ-ॿ]/;

// Tokens of one word: consonants (with the vowel that follows, if written),
// independent vowels, and nasal or visarga marks.
function parse(word) {
  const chars = [...word.normalize('NFC')];
  const units = [];
  for (let i = 0; i < chars.length; i++) {
    let ch = chars[i];
    if (chars[i + 1] === NUKTA) { ch += NUKTA; i++; }
    if (CONS[ch]) { units.push({ t: 'c', ph: CONS[ch][0], place: CONS[ch][1], v: 'ə', inherent: true }); continue; }
    if (VOWELS[ch]) { units.push({ t: 'v', v: VOWELS[ch] }); continue; }
    const last = units[units.length - 1];
    if (MATRAS[ch] && last && last.t === 'c') { last.v = MATRAS[ch]; last.inherent = false; continue; }
    if (ch === VIRAMA && last && last.t === 'c') { last.v = ''; last.inherent = false; continue; }
    if (ch === ANUSVARA || ch === CANDRABINDU) { units.push({ t: 'n', soft: ch === CANDRABINDU }); continue; }
    if (ch === VISARGA) { units.push({ t: 'h' }); continue; }
  }
  return units;
}

const hasVowel = (u) => u && ((u.t === 'c' && u.v) || u.t === 'v');

function dropSchwas(units) {
  const cons = units.map((u, i) => [u, i]).filter(([u]) => u.t === 'c' || u.t === 'v');
  if (cons.length < 2) return;
  // End of the word, unless it ends in a cluster (मित्र keeps its final a).
  const lastI = units.map((u) => u.t === 'c' || u.t === 'v').lastIndexOf(true);
  const last = units[lastI];
  const prev = units[lastI - 1];
  if (last && last.t === 'c' && last.inherent && !(prev && prev.t === 'c' && !prev.v)) last.v = '';
  // Medial: V C ə C V, scanning right to left so each decision sees the
  // ones already made after it.
  for (let i = lastI - 1; i > 0; i--) {
    const u = units[i];
    if (u.t !== 'c' || !u.inherent || !u.v) continue;
    const left = units[i - 1];
    const right = units[i + 1];
    if (!hasVowel(left) || !right || right.t !== 'c' || !right.v) continue;
    // The first syllable keeps its vowel.
    if (units.slice(0, i).filter(hasVowel).length < 1) continue;
    u.v = '';
  }
}

function wordToIpa(word) {
  const units = parse(word);
  dropSchwas(units);
  let out = '';
  for (let i = 0; i < units.length; i++) {
    const u = units[i];
    if (u.t === 'c') out += u.ph + u.v;
    else if (u.t === 'v') out += u.v;
    else if (u.t === 'h') out += 'h';
    else if (u.t === 'n') {
      const next = units[i + 1];
      // Before a consonant the nasal sign is that consonant's own nasal;
      // otherwise it nasalises the vowel just spoken.
      if (!u.soft && next && next.t === 'c') out += NASAL_FOR[next.place];
      else out = out.replace(/([aeiouəɪʊɛɔ])(ː?)$/, '$1̃$2');
    }
  }
  return out;
}

const DIGITS = '०१२३४५६७८९';

// Phonemes for mixed text: Devanagari words go through the rules above;
// Latin words and numbers go through the English phonemizer passed in.
export async function hindiPhonemes(text, english) {
  const t = text.replace(/[०-९]/g, (d) => String(DIGITS.indexOf(d))).replace(/[।॥]/g, '.');
  const parts = t.match(/[ऀ-ॿ]+|[A-Za-z0-9'][A-Za-z0-9' .,-]*[A-Za-z0-9]|[A-Za-z0-9]|[;:,.!?—…"()“”]|\s+/g) || [];
  const out = [];
  for (const p of parts) {
    if (DEVANAGARI.test(p)) out.push(wordToIpa(p));
    else if (/[A-Za-z0-9]/.test(p)) out.push((await english(p)).trim());
    else if (/\s/.test(p)) out.push(' ');
    else out.push(p);
  }
  return out.join('').replace(/ {2,}/g, ' ').trim();
}

export { wordToIpa };
