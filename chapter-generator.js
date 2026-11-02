/**
 * Builds chapter pages, menus, home-page previews, and eBook sections
 * from writings-data.json. Used by the control panel the same way
 * html-generator.js builds the Cannon Art galleries.
 */
(function (root) {
    'use strict';

    const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
    const MONTH_RE = /^(January|February|March|April|May|June|July|August|September|October|November|December),?\s+(\d{4})$/i;
    const RESERVED_SLUGS = new Set([
        'index.html', 'about.html', 'contact.html', 'terms-of-use.html',
        'ebook-demo.html', 'control-panel.html', 'number2.html', 'other-musings.html'
    ]);
    const STATIC_PAGES = ['index.html', 'about.html', 'contact.html', 'terms-of-use.html', 'ebook-demo.html'];

    function escapeHtml(text) {
        return String(text == null ? '' : text)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    }

    function stripTags(html) {
        return String(html || '').replace(/<[^>]+>/g, '');
    }

    function parseBlocks(bodyHtml) {
        const blocks = [];
        const re = /<div class="([^"]*)"([^>]*)>([\s\S]*?)<\/div>/g;
        let match;
        const source = String(bodyHtml || '');
        while ((match = re.exec(source))) {
            blocks.push({ cls: match[1], attrs: match[2] || '', inner: match[3] });
        }
        return blocks;
    }

    function bodyHtmlToText(bodyHtml) {
        return parseBlocks(bodyHtml).map((block) => (
            block.cls.includes('doc-blank') ? '' : block.inner
        )).join('\n');
    }

    function prefersTight(bodyHtml) {
        const blocks = parseBlocks(bodyHtml).filter((block) => !block.cls.includes('doc-blank'));
        const content = blocks.filter((block) => !MONTH_RE.test(stripTags(block.inner).trim()));
        if (!content.length) return false;
        const tight = content.filter((block) => /(^|\s)tight(\s|$)/.test(block.cls)).length;
        return tight * 2 >= content.length;
    }

    function textToBodyHtml(text, preferTight) {
        const lines = String(text || '').replace(/\r\n/g, '\n').replace(/\n+$/g, '').split('\n');
        return lines.map((line) => {
            if (!line.trim()) return '<div class="doc-blank"></div>';
            const plain = stripTags(line).trim();
            const isDate = MONTH_RE.test(plain);
            let inner = line.includes('<') ? line.trim() : escapeHtml(line.trim());
            const classes = ['doc-p'];
            if (isDate || preferTight) classes.push('tight');
            if (isDate && !/<\s*em\b/i.test(inner)) inner = '<em>' + escapeHtml(plain) + '</em>';
            return '<div class="' + classes.join(' ') + '">' + inner + '</div>';
        }).join('\n');
    }

    /** Keep the stored HTML when the editor text was not changed, so italics and indents survive. */
    function resolveBody(bodyHtml, editorText, preferTight) {
        const current = bodyHtmlToText(bodyHtml);
        const next = String(editorText || '').replace(/\r\n/g, '\n');
        if (next === current.replace(/\r\n/g, '\n')) return bodyHtml || '';
        const tight = typeof preferTight === 'boolean' ? preferTight : prefersTight(bodyHtml);
        return textToBodyHtml(next, tight);
    }

    function writtenKey(chapter) {
        const match = String(chapter.written || '').trim().match(/^([A-Za-z]+)\s+(\d{4})$/);
        if (!match) return { y: 0, m: 0 };
        const month = MONTHS.findIndex((name) => name.toLowerCase() === match[1].toLowerCase());
        if (month < 0) return { y: 0, m: 0 };
        return { y: Number(match[2]), m: month + 1 };
    }

    function sortChapters(chapters) {
        return [...(chapters || [])].sort((a, b) => (Number(a.number) - Number(b.number)) || String(a.title).localeCompare(String(b.title)));
    }

    function latestChapters(chapters) {
        return [...(chapters || [])].sort((a, b) => {
            const aw = writtenKey(a);
            const bw = writtenKey(b);
            if (bw.y !== aw.y) return bw.y - aw.y;
            if (bw.m !== aw.m) return bw.m - aw.m;
            return (Number(b.savedAt) || 0) - (Number(a.savedAt) || 0);
        }).slice(0, 2);
    }

    function teaser(bodyHtml) {
        const lines = [];
        parseBlocks(bodyHtml).some((block) => {
            if (block.cls.includes('doc-blank')) return false;
            const spans = [...block.inner.matchAll(/<span class="doc-l">([\s\S]*?)<\/span>/g)].map((m) => m[1]);
            const parts = spans.length ? spans : [block.inner];
            parts.some((part) => {
                const text = stripTags(part).replace(/\s+/g, ' ').trim().replace(/[,;:—-]+$/g, '').trim();
                if (text) lines.push(text);
                return lines.length >= 2;
            });
            return lines.length >= 2;
        });
        return (lines.join(', ') || 'New writing') + '...';
    }

    function slugify(title) {
        const base = String(title || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
        return (base || 'chapter') + '.html';
    }

    function uniqueSlug(title, chapters, ignoreId) {
        let slug = slugify(title);
        const taken = new Set((chapters || []).filter((ch) => ch.id !== ignoreId).map((ch) => ch.slug));
        RESERVED_SLUGS.forEach((name) => taken.add(name));
        if (!taken.has(slug)) return slug;
        const stem = slug.replace(/\.html$/, '');
        let n = 2;
        while (taken.has(stem + '-' + n + '.html')) n += 1;
        return stem + '-' + n + '.html';
    }

    function validateChapter(chapter, chapters) {
        const title = String(chapter.title || '').trim();
        const number = Number(chapter.number);
        if (!title) return 'Please enter a title';
        if (!Number.isInteger(number) || number < 1) return 'Chapter number must be a whole number, 1 or higher';
        if ((chapters || []).some((ch) => ch.id !== chapter.id && Number(ch.number) === number)) {
            return 'Chapter ' + number + ' already exists';
        }
        if (chapter.written && !/^[A-Za-z]+\s+\d{4}$/.test(String(chapter.written).trim())) {
            return 'Written date should look like October 2026';
        }
        return '';
    }

    function validateThought(thought) {
        const title = String(thought.title || '').trim();
        if (!title) return 'Please enter a title';
        if (thought.written && !/^[A-Za-z]+\s+\d{4}$/.test(String(thought.written).trim())) {
            return 'Written date should look like October 2026';
        }
        return '';
    }

    function uniqueAnchor(title, thoughts, ignoreId) {
        let base = slugify(title).replace(/\.html$/, '') || 'thought';
        const taken = new Set((thoughts || []).filter((item) => item.id !== ignoreId).map((item) => item.anchor));
        if (!taken.has(base)) return base;
        let n = 2;
        while (taken.has(base + '-' + n)) n += 1;
        return base + '-' + n;
    }

    function sortThoughts(thoughts) {
        return [...(thoughts || [])].sort((a, b) => (Number(b.savedAt) || 0) - (Number(a.savedAt) || 0) || String(a.title).localeCompare(String(b.title)));
    }

    const AUDIT_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

    function lineChange(beforeText, afterText) {
        const before = String(beforeText || '').replace(/\r\n/g, '\n').split('\n');
        const after = String(afterText || '').replace(/\r\n/g, '\n').split('\n');
        if (before.length === 1 && before[0] === '') before.length = 0;
        if (after.length === 1 && after[0] === '') after.length = 0;
        const pool = new Map();
        before.forEach((line) => pool.set(line, (pool.get(line) || 0) + 1));
        let linesAdded = 0;
        after.forEach((line) => {
            const count = pool.get(line) || 0;
            if (count > 0) pool.set(line, count - 1);
            else linesAdded += 1;
        });
        let linesRemoved = 0;
        pool.forEach((count) => { linesRemoved += count; });
        return { linesAdded, linesRemoved };
    }

    function auditDayKey(timestamp) {
        const date = new Date(timestamp);
        const month = String(date.getMonth() + 1).padStart(2, '0');
        const day = String(date.getDate()).padStart(2, '0');
        return date.getFullYear() + '-' + month + '-' + day;
    }

    function auditDayLabel(timestamp) {
        const date = new Date(timestamp);
        return date.getDate() + ' ' + AUDIT_MONTHS[date.getMonth()] + ' ' + date.getFullYear();
    }

    function describeAudit(entry) {
        const subject = entry.kind === 'chapter'
            ? 'Chapter ' + entry.number + ', ' + entry.title
            : 'Musing, ' + entry.title;
        const verb = { edit: 'edited', delete: 'deleted', add: 'added', restore: 'restored' }[entry.action] || entry.action;
        const parts = [];
        if (entry.linesAdded) parts.push(entry.linesAdded + ' line' + (entry.linesAdded === 1 ? '' : 's') + ' added');
        if (entry.linesRemoved) parts.push(entry.linesRemoved + ' line' + (entry.linesRemoved === 1 ? '' : 's') + ' removed');
        if (!parts.length) parts.push('no line change');
        const notes = [];
        if (entry.titleChanged) notes.push('title changed');
        if (entry.numberChanged) notes.push('chapter number changed');
        if (entry.writtenChanged) notes.push('written date changed');
        return entry.dayLabel + ' — ' + subject + ': ' + verb + ', ' + parts.join(', ') + (notes.length ? '; ' + notes.join(', ') : '');
    }

    function pruneAuditEntries(entries, now) {
        const cutoff = new Date(now || Date.now());
        cutoff.setMonth(cutoff.getMonth() - 6);
        const limit = cutoff.getTime();
        return (entries || []).filter((entry) => Number(entry.at) >= limit);
    }

    function buildAuditReport(entries) {
        const groups = [];
        const byDay = new Map();
        [...(entries || [])].sort((a, b) => Number(b.at) - Number(a.at)).forEach((entry) => {
            let group = byDay.get(entry.day);
            if (!group) {
                group = { day: entry.day, dayLabel: entry.dayLabel, changes: [] };
                byDay.set(entry.day, group);
                groups.push(group);
            }
            group.changes.push({
                id: entry.id,
                at: entry.at,
                action: entry.action,
                kind: entry.kind,
                itemId: entry.itemId,
                title: entry.title,
                number: entry.number || null,
                linesAdded: entry.linesAdded || 0,
                linesRemoved: entry.linesRemoved || 0,
                summary: entry.summary
            });
        });
        return groups;
    }

    function menuHtml(current, chapters) {
        const rows = [];
        function add(href, label, raw) {
            const active = href === current ? ' class="active"' : '';
            const inner = raw ? label : escapeHtml(label);
            rows.push('      <li><a href="' + escapeHtml(href) + '"' + active + '>' + inner + '</a></li>');
        }
        add('ebook-demo.html', 'eBook');
        sortChapters(chapters).forEach((ch) => {
            add(ch.slug, '<span class="menu-chapter">Chapter ' + Number(ch.number) + '</span>' + escapeHtml(ch.title), true);
        });
        add('other-musings.html', 'Other Musings');
        add('about.html', 'About Me');
        add('contact.html', 'Contact Me');
        add('control-panel.html', 'Admin');
        return '    <ul class="menu-nav">\n' + rows.join('\n') + '\n    </ul>';
    }

    function preserveNewlines(original, edit) {
        const crlf = original.includes('\r\n');
        const text = crlf ? original.replace(/\r\n/g, '\n') : original;
        const next = edit(text);
        return crlf ? next.replace(/\n/g, '\r\n') : next;
    }

    function replaceMenu(html, current, chapters) {
        return preserveNewlines(html, (text) => {
            if (!text.includes('<ul class="menu-nav">')) throw new Error('Menu not found in ' + current);
            return text.replace(/[ \t]*<ul class="menu-nav">[\s\S]*?<\/ul>/, menuHtml(current, chapters));
        });
    }

    function latestWritingsHtml(chapters) {
        let cards = '      <h3 class="previews-heading">Latest Writings</h3>\n';
        latestChapters(chapters).forEach((ch) => {
            const when = ch.written ? ' · ' + escapeHtml(ch.written) : '';
            cards += '\n      <a href="' + escapeHtml(ch.slug) + '" class="preview-card">\n';
            cards += '        <span class="menu-chapter">Chapter ' + Number(ch.number) + when + '</span>\n';
            cards += '        <span class="preview-title">' + escapeHtml(ch.title) + '</span>\n';
            cards += '        <span class="preview-teaser">' + escapeHtml(teaser(ch.bodyHtml)) + '</span>\n';
            cards += '        <span class="preview-read">Read →</span>\n';
            cards += '      </a>\n';
        });
        return cards;
    }

    function replaceLatest(html, chapters) {
        return preserveNewlines(html, (text) => {
            const re = /(<!-- NEW-MATERIAL:START -->\n)[\s\S]*?( *<!-- NEW-MATERIAL:END -->)/;
            if (!re.test(text)) throw new Error('Latest Writings markers are missing in index.html');
            return text.replace(re, (_, start, end) => start + latestWritingsHtml(chapters) + end);
        });
    }

    function indentBody(bodyHtml, indent) {
        return String(bodyHtml || '').replace(/\r\n/g, '\n').split('\n')
            .map((line) => line.trim())
            .filter((line) => line)
            .map((line) => indent + line)
            .join('\n');
    }

    function ebookSections(chapters) {
        return sortChapters(chapters).map((ch) => {
            const headingText = 'Chapter ' + Number(ch.number) + ': ' + ch.title;
            const heading = 'Chapter ' + Number(ch.number) + ': ' + escapeHtml(ch.title);
            return '          <section class="book-section doc" data-title="' + escapeHtml(headingText) + '">\n'
                + '            <h2 class="chapter-heading">' + heading + '</h2>\n'
                + indentBody(ch.bodyHtml, '            ') + '\n'
                + '          </section>';
        }).join('\n');
    }

    function replaceEbook(html, chapters) {
        return preserveNewlines(html, (text) => {
            const re = /(<!-- CHAPTERS:START -->\n)[\s\S]*?( *<!-- CHAPTERS:END -->)/;
            if (!re.test(text)) throw new Error('eBook chapter markers are missing in ebook-demo.html');
            return text.replace(re, (_, start, end) => start + ebookSections(chapters) + '\n' + end);
        });
    }

    function jsString(value) {
        return String(value || '').replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\r?\n/g, ' ');
    }

    function chapterNav(prev, next) {
        let nav = '    <nav class="chapter-nav" aria-label="Chapters">\n';
        if (prev) {
            nav += '      <a href="' + escapeHtml(prev.slug) + '" class="chapter-nav-prev"><span class="menu-chapter">← Previous page</span>'
                + escapeHtml(prev.title) + '</a>\n';
        }
        if (next) {
            nav += '      <a href="' + escapeHtml(next.slug) + '" class="chapter-nav-next"><span class="menu-chapter">Next page →</span>'
                + escapeHtml(next.title) + '</a>\n';
        } else {
            nav += '      <a href="ebook-demo.html" class="chapter-nav-next"><span class="menu-chapter">Next →</span>Read the eBook</a>\n';
        }
        nav += '    </nav>';
        return nav;
    }

    function renderChapterPage(chapter, prev, next, chapters) {
        const title = String(chapter.title || '').trim();
        const heading = 'Chapter ' + Number(chapter.number) + ': ' + escapeHtml(title);
        const body = indentBody(chapter.bodyHtml, '      ');
        return '<!DOCTYPE html>\n'
            + '<html lang="en">\n'
            + '<head>\n'
            + '  <meta charset="UTF-8">\n'
            + '  <meta name="viewport" content="width=device-width, initial-scale=1.0">\n'
            + '  <title>' + escapeHtml(title) + ' — A Writer\'s Block</title>\n'
            + '  <meta property="og:title" content="' + escapeHtml(title) + ' — A Writer\'s Block">\n'
            + '  <meta property="og:description" content="Poetry by Richie. Raw, unfiltered writing from the heart.">\n'
            + '  <meta property="og:image" content="https://the-writers-block.github.io/Writing/LD-Writing_coffee_shop_No4.png">\n'
            + '  <meta property="og:type" content="article">\n'
            + '  <link rel="stylesheet" href="style.css?v=6">\n'
            + '</head>\n'
            + '<body>\n\n'
            + '  <!-- MENU OVERLAY -->\n'
            + '  <div class="menu-overlay" id="menuOverlay" onclick="closeMenu()"></div>\n\n'
            + '  <!-- SLIDE-OUT MENU -->\n'
            + '  <nav class="menu-panel" id="menuPanel">\n'
            + '    <div class="menu-header">\n'
            + '      <span class="menu-header-title">Menu</span>\n'
            + '      <button class="menu-close" onclick="closeMenu()" aria-label="Close menu">&times;</button>\n'
            + '    </div>\n'
            + menuHtml(chapter.slug, chapters) + '\n'
            + '  </nav>\n\n'
            + '  <!-- HEADER -->\n'
            + '  <header class="site-header">\n'
            + '    <div class="header-inner">\n'
            + '      <button class="menu-btn" onclick="openMenu()" aria-label="Open menu">\n'
            + '        <span class="hamburger">\n'
            + '          <span></span>\n'
            + '          <span></span>\n'
            + '          <span></span>\n'
            + '        </span>\n'
            + '        Menu\n'
            + '      </button>\n'
            + '      <a href="index.html" class="site-title">A Writer\'s Block</a>\n'
            + '    </div>\n'
            + '  </header>\n\n'
            + '  <!-- MAIN CONTENT -->\n'
            + '  <main>\n'
            + '    <div class="poem-header">\n'
            + '      <h2 class="chapter-heading">' + heading + '</h2>\n'
            + '    </div>\n\n'
            + '    <div class="poem-body doc">\n'
            + body + '\n'
            + '    </div>\n\n'
            + '    <!-- SHARE -->\n'
            + '    <div class="share-links">\n'
            + '      <span class="share-label">Share this:</span>\n'
            + '      <a href="javascript:void(0)" onclick="sharePoem()" class="share-btn">Share →</a>\n'
            + '    </div>\n\n'
            + chapterNav(prev, next) + '\n\n'
            + '    <a href="index.html" class="back-link">← Back to Home</a>\n'
            + '  </main>\n\n'
            + '  <!-- FOOTER -->\n'
            + '  <footer class="site-footer">\n'
            + '    <div class="footer-inner">\n'
            + '      <span>&copy; 2026 A Writer\'s Block | All Rights Reserved | <a href="terms-of-use.html">Terms of Use</a> | <a href="contact.html" class="footer-contact">Contact Me</a></span>\n'
            + '      <span class="footer-logo">\n'
            + '        <img src="AvId_Digital_Small.png" alt="Avid Digital">\n'
            + '      </span>\n'
            + '    </div>\n'
            + '  </footer>\n\n'
            + '  <script>\n'
            + '    function openMenu() {\n'
            + '      document.getElementById(\'menuOverlay\').classList.add(\'open\');\n'
            + '      document.getElementById(\'menuPanel\').classList.add(\'open\');\n'
            + '    }\n'
            + '    function closeMenu() {\n'
            + '      document.getElementById(\'menuOverlay\').classList.remove(\'open\');\n'
            + '      document.getElementById(\'menuPanel\').classList.remove(\'open\');\n'
            + '    }\n'
            + '    function sharePoem() {\n'
            + '      if (navigator.share) {\n'
            + '        navigator.share({ title: \'' + jsString(title) + ' — A Writer\\\'s Block\', url: window.location.href });\n'
            + '      } else {\n'
            + '        navigator.clipboard.writeText(window.location.href);\n'
            + '        alert(\'Link copied to clipboard!\');\n'
            + '      }\n'
            + '    }\n'
            + '  </script>\n'
            + '  <script async data-hostname="the-writers-block.github.io" src="https://scripts.simpleanalyticscdn.com/latest.js"></script>\n'
            + '</body>\n'
            + '</html>\n';
    }

    function buildPublishFiles(chapters, pages, thoughts) {
        const sorted = sortChapters(chapters);
        const files = {};
        sorted.forEach((chapter, index) => {
            files[chapter.slug] = renderChapterPage(chapter, sorted[index - 1], sorted[index + 1], sorted);
        });
        files['other-musings.html'] = renderOtherMusingsPage(thoughts || [], sorted);
        STATIC_PAGES.forEach((name) => {
            const source = pages && pages[name];
            if (!source) throw new Error('Missing ' + name + ' — the control panel needs the current page to update its menu');
            let html = replaceMenu(source, name, sorted);
            if (name === 'index.html') html = replaceLatest(html, sorted);
            if (name === 'ebook-demo.html') html = replaceEbook(html, sorted);
            files[name] = html;
        });
        return files;
    }

    function renderOtherMusingsPage(thoughts, chapters) {
        const pieces = sortThoughts(thoughts);
        let body = '    <h2>Other Musings</h2>\n'
            + '    <p>Thoughts, tantalising ideas and musings on life.</p>\n';
        if (!pieces.length) {
            body += '    <p class="bio-note">No thoughts yet.</p>\n';
        }
        pieces.forEach((thought) => {
            const anchor = thought.anchor || uniqueAnchor(thought.title, pieces, thought.id);
            body += '\n    <article class="musing" id="' + escapeHtml(anchor) + '">\n';
            body += '      <h3>' + escapeHtml(thought.title) + '</h3>\n';
            if (thought.written) body += '      <p class="menu-chapter">' + escapeHtml(thought.written) + '</p>\n';
            body += '      <div class="poem-body doc">\n' + indentBody(thought.bodyHtml, '        ') + '\n      </div>\n';
            body += '    </article>\n';
        });
        return '<!DOCTYPE html>\n'
            + '<html lang="en">\n'
            + '<head>\n'
            + '  <meta charset="UTF-8">\n'
            + '  <meta name="viewport" content="width=device-width, initial-scale=1.0">\n'
            + '  <title>Other Musings — A Writer\'s Block</title>\n'
            + '  <meta property="og:title" content="Other Musings — A Writer\'s Block">\n'
            + '  <meta property="og:description" content="Thoughts, tantalising ideas and musings on life.">\n'
            + '  <meta property="og:image" content="https://the-writers-block.github.io/Writing/LD-Writing_coffee_shop_No4.png">\n'
            + '  <meta property="og:type" content="website">\n'
            + '  <link rel="stylesheet" href="style.css?v=8">\n'
            + '</head>\n'
            + '<body>\n\n'
            + '  <div class="menu-overlay" id="menuOverlay" onclick="closeMenu()"></div>\n\n'
            + '  <nav class="menu-panel" id="menuPanel">\n'
            + '    <div class="menu-header">\n'
            + '      <span class="menu-header-title">Menu</span>\n'
            + '      <button class="menu-close" onclick="closeMenu()" aria-label="Close menu">&times;</button>\n'
            + '    </div>\n'
            + menuHtml('other-musings.html', chapters) + '\n'
            + '  </nav>\n\n'
            + '  <header class="site-header">\n'
            + '    <div class="header-inner">\n'
            + '      <button class="menu-btn" onclick="openMenu()" aria-label="Open menu">\n'
            + '        <span class="hamburger"><span></span><span></span><span></span></span>\n'
            + '        Menu\n'
            + '      </button>\n'
            + '      <a href="index.html" class="site-title">A Writer\'s Block</a>\n'
            + '    </div>\n'
            + '  </header>\n\n'
            + '  <main>\n' + body + '    <a href="index.html" class="back-link">← Back to Home</a>\n  </main>\n\n'
            + '  <footer class="site-footer">\n'
            + '    <div class="footer-inner">\n'
            + '      <span>&copy; 2026 A Writer\'s Block | All Rights Reserved | <a href="terms-of-use.html">Terms of Use</a> | <a href="contact.html" class="footer-contact">Contact Me</a></span>\n'
            + '      <span class="footer-logo"><img src="AvId_Digital_Small.png" alt="Avid Digital"></span>\n'
            + '    </div>\n'
            + '  </footer>\n\n'
            + '  <script>\n'
            + '    function openMenu() {\n'
            + '      document.getElementById(\'menuOverlay\').classList.add(\'open\');\n'
            + '      document.getElementById(\'menuPanel\').classList.add(\'open\');\n'
            + '    }\n'
            + '    function closeMenu() {\n'
            + '      document.getElementById(\'menuOverlay\').classList.remove(\'open\');\n'
            + '      document.getElementById(\'menuPanel\').classList.remove(\'open\');\n'
            + '    }\n'
            + '  </script>\n'
            + '  <script async data-hostname="the-writers-block.github.io" src="https://scripts.simpleanalyticscdn.com/latest.js"></script>\n'
            + '</body>\n</html>\n';
    }

    root.ChapterSite = {
        STATIC_PAGES,
        escapeHtml,
        bodyHtmlToText,
        textToBodyHtml,
        resolveBody,
        prefersTight,
        sortChapters,
        latestChapters,
        teaser,
        slugify,
        uniqueSlug,
        validateChapter,
        validateThought,
        uniqueAnchor,
        sortThoughts,
        lineChange,
        auditDayKey,
        auditDayLabel,
        describeAudit,
        pruneAuditEntries,
        buildAuditReport,
        menuHtml,
        replaceMenu,
        replaceLatest,
        replaceEbook,
        renderChapterPage,
        renderOtherMusingsPage,
        buildPublishFiles
    };
})(typeof globalThis !== 'undefined' ? globalThis : window);
