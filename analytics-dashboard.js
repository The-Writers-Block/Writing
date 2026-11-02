// Admin Analytics dashboard — Simple Analytics Stats API.
(function () {
    'use strict';

    const SA_HOSTNAME = 'the-writers-block.github.io';
    const SA_FIELDS = 'visitors,pageviews,histogram,pages,referrers,countries,device_types,seconds_on_page';

    const PAGE_NAMES = {
        '/': 'Home',
        '/Writing': 'Home',
        '/Writing/': 'Home',
        '/Writing/index.html': 'Home',
        'index.html': 'Home',
        'about.html': 'About Me',
        'contact.html': 'Contact Me',
        'ebook-demo.html': 'eBook',
        'other-musings.html': 'Other Musings',
        'terms-of-use.html': 'Terms of Use',
        'control-panel.html': 'Control Panel',
        'a-woman-scorned.html': 'A Woman Scorned',
        'man-of-the-house.html': 'Man of the House',
        'when-in-hell-you-need-a-friend.html': 'When in Hell, you need a friend',
        'isaiah.html': 'Isaiah',
        'the-poem.html': 'The Poem',
        'the-wisdom-to-be-foolish.html': 'The Wisdom To Be Foolish',
        'money-spider.html': 'Money Spider',
        'mrs-edge.html': 'Mrs Edge'
    };

    const SCREEN_NAMES = {
        mobile: 'Phone',
        tablet: 'Tablet',
        desktop: 'Computer',
        tv: 'TV'
    };

    function analyticsUrl() {
        return 'https://simpleanalytics.com/' + SA_HOSTNAME + '.json?version=6&fields='
            + encodeURIComponent(SA_FIELDS) + '&start=today-30d&end=today&timezone=Europe/London';
    }

    function escapeHtml(text) {
        return String(text)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    }

    function pageName(path) {
        const raw = String(path || '/').split('?')[0];
        if (PAGE_NAMES[raw]) return PAGE_NAMES[raw];
        const file = raw.replace(/^\/Writing\//i, '').replace(/^\//, '');
        if (!file || file === 'index.html') return 'Home';
        if (PAGE_NAMES[file]) return PAGE_NAMES[file];
        return file.replace(/\.html$/i, '').replace(/[-_]/g, ' ') || 'Home';
    }

    function countryName(code) {
        const raw = String(code || '').trim();
        if (!raw) return 'Unknown';
        try {
            const name = new Intl.DisplayNames(['en'], { type: 'region' }).of(raw);
            return name || raw;
        } catch (e) {
            return raw;
        }
    }

    function screenName(key) {
        return SCREEN_NAMES[key] || key;
    }

    function formatDate(iso) {
        const d = new Date(String(iso).slice(0, 10) + 'T00:00:00Z');
        if (Number.isNaN(d.getTime())) return iso;
        return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
    }

    function formatSeconds(total) {
        const n = Math.max(0, Math.round(Number(total) || 0));
        if (n < 60) return n + ' sec';
        const m = Math.floor(n / 60);
        const s = n % 60;
        return s ? m + ' min ' + s + ' sec' : m + ' min';
    }

    function emptyNote() {
        return '<p class="analytics-empty">Nothing to show yet.</p>';
    }

    function table(headers, rows) {
        if (!rows.length) return emptyNote();
        const head = headers.map((h) => '<th>' + escapeHtml(h) + '</th>').join('');
        const body = rows.map((cells) => (
            '<tr>' + cells.map((c) => '<td>' + escapeHtml(String(c)) + '</td>').join('') + '</tr>'
        )).join('');
        return '<table class="analytics-table"><thead><tr>' + head + '</tr></thead><tbody>' + body + '</tbody></table>';
    }

    function rankedList(items, nameFn, valueKey) {
        const rows = (items || [])
            .map((item) => ({
                name: nameFn ? nameFn(item.value) : item.value,
                value: item[valueKey] || item.pageviews || 0
            }))
            .filter((row) => row.value > 0)
            .sort((a, b) => b.value - a.value)
            .slice(0, 15)
            .map((row) => [row.name, row.value]);
        return table(['Name', 'Visits'], rows);
    }

    function recentDays(histogram) {
        const withCounts = (histogram || []).filter((d) => d && (d.pageviews > 0 || d.visitors > 0));
        if (!withCounts.length) return '';
        const latest = withCounts.slice(-7).map((d) => {
            const date = d.date || d.created || '';
            return formatDate(date) + ' · ' + (d.pageviews || 0);
        });
        return '<p class="analytics-recent">' + escapeHtml(latest.join('  |  ')) + '</p>';
    }

    function section(title, html) {
        return '<section class="analytics-block"><h3>' + escapeHtml(title) + '</h3>' + html + '</section>';
    }

    function errorMessage(data) {
        const apiError = data && data.error ? String(data.error) : '';
        if (/api-key/i.test(apiError) || /not found/i.test(apiError)) {
            return 'Set this website to Public in Simple Analytics Settings, then refresh.';
        }
        return apiError || 'Could not load analytics.';
    }

    window.loadAnalyticsDashboard = async function loadAnalyticsDashboard() {
        const root = document.getElementById('analyticsDashboard');
        if (!root) return;
        root.innerHTML = '<p>Loading visitor figures…</p>';
        try {
            const res = await fetch(analyticsUrl(), { headers: { Accept: 'application/json' } });
            const data = await res.json().catch(() => ({}));
            if (!res.ok || data.ok === false) throw new Error(errorMessage(data));

            const visitors = data.visitors || 0;
            const pageviews = data.pageviews || 0;
            const timeOnPage = data.seconds_on_page;
            const summaryParts = [
                visitors === 1 ? '1 visitor' : visitors + ' visitors',
                pageviews === 1 ? '1 page view' : pageviews + ' page views'
            ];
            if (timeOnPage != null && timeOnPage !== '') {
                summaryParts.push(formatSeconds(timeOnPage) + ' on page');
            }

            root.innerHTML = ''
                + '<p class="analytics-summary">' + escapeHtml(summaryParts.join(' · ') + '.') + '</p>'
                + recentDays(data.histogram)
                + section('Pages', rankedList(data.pages, pageName, 'pageviews'))
                + section('Location', rankedList(data.countries, countryName, 'pageviews'))
                + section('How people arrived', rankedList(data.referrers, (host) => {
                    if (!host || host === 'direct') return 'Direct visit';
                    return String(host).replace(/^www\./, '');
                }, 'pageviews'))
                + section('Device', rankedList(data.device_types, screenName, 'pageviews'));
        } catch (e) {
            root.innerHTML = '<p>' + escapeHtml(e.message || 'Could not load analytics.') + '</p>';
        }
    };
})();
