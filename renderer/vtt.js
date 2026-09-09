// Minimal, tolerant WebVTT parser that also accepts common SRT input.
// Exposes window.VTT.
(function (global) {
  'use strict';

  function pad(n) {
    return n < 10 ? '0' + n : String(n);
  }

  // Accepts "HH:MM:SS.mmm", "MM:SS.mmm", or "MM:SS".
  function parseTimestamp(token) {
    const parts = token.split(':');
    const secPart = parts.pop();
    const secFloat = parseFloat(secPart.replace(',', '.'));
    let result = secFloat;
    if (parts.length) result += parseInt(parts.pop(), 10) * 60;
    if (parts.length) result += parseInt(parts.pop(), 10) * 3600;
    return result;
  }

  function escapeHtml(text) {
    return text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

  // Convert the small set of inline VTT tags into safe HTML and escape the rest.
  function decodeInline(text) {
    const tokens = text.split(/(<[^>]*>)/g);
    let out = '';
    for (const tok of tokens) {
      if (!tok) continue;
      if (tok.startsWith('<')) {
        if (/^<b>$/i.test(tok)) out += '<strong>';
        else if (/^<\/b>$/i.test(tok)) out += '</strong>';
        else if (/^<i>$/i.test(tok)) out += '<em>';
        else if (/^<\/i>$/i.test(tok)) out += '</em>';
        else if (/^<u>$/i.test(tok)) out += '<u>';
        else if (/^<\/u>$/i.test(tok)) out += '</u>';
        else if (/^<c\.[\w-]+>$/i.test(tok)) {
          out += '<span class="vtt-tone">';
        } else if (/^<\/c>$/i.test(tok)) out += '</span>';
        // voice, lang, ruby, and other decorative tags are collapsed to their text.
      } else {
        out += escapeHtml(tok);
      }
    }
    return out;
  }

  function parseCueObject(timing, textLines, id) {
    const arrowIndex = timing.indexOf('-->');
    if (arrowIndex === -1) return null;
    const startToken = timing.slice(0, arrowIndex).trim();
    let rest = timing.slice(arrowIndex + 3).trim();
    const endToken = rest.split(/\s+/)[0];
    const settings = rest.slice(endToken.length).trim();
    return {
      id: id || '',
      start: parseTimestamp(startToken),
      end: parseTimestamp(endToken),
      settings,
      text: textLines.join('\n').trim(),
      html: decodeInline(textLines.join('\n').trim()),
    };
  }

  function parse(text) {
    const normalized = String(text || '')
      .replace(/\r\n/g, '\n')
      .replace(/\r/g, '\n');
    const cues = [];
    // WebVTT header: WEBVTT / WEBVTT - comment. SRT files just start with a number.
    const lines = normalized.split('\n');
    let i = 0;
    while (i < lines.length) {
      const line = lines[i];
      // Skip the file header line(s) that appear before the first timing line.
      if (i === 0 && (line.trim().startsWith('WEBVTT') || line.trim() === '')) {
        i += 1;
        continue;
      }

      // Collect a block: optional cue id, then a timing line, then text lines.
      const block = [];
      while (i < lines.length && lines[i].trim() !== '') {
        block.push(lines[i]);
        i += 1;
      }
      // Consume the blank separator.
      while (i < lines.length && lines[i].trim() === '') i += 1;
      if (!block.length) continue;

      const timingIndex = block.findIndex((b) => b.includes('-->'));
      if (timingIndex === -1) continue;
      const id = timingIndex > 0 ? block.slice(0, timingIndex).join(' ') : '';
      const cue = parseCueObject(
        block[timingIndex],
        block.slice(timingIndex + 1),
        id
      );
      if (cue && cue.end > cue.start) cues.push(cue);
    }

    cues.sort((a, b) => a.start - b.start);
    return cues;
  }

  global.VTT = { parse, formatTime: undefined };
})(window);
