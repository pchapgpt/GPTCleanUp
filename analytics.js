// ----------------------------
// Analytics: Word Cloud & Frequency Chart
// ----------------------------

// Common stop words to filter from word cloud
var STOP_WORDS = new Set([
    'a', 'an', 'the', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
    'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could',
    'should', 'may', 'might', 'shall', 'can', 'need', 'dare', 'ought',
    'used', 'to', 'of', 'in', 'for', 'on', 'with', 'at', 'by', 'from',
    'as', 'into', 'through', 'during', 'before', 'after', 'above', 'below',
    'between', 'out', 'off', 'over', 'under', 'again', 'further', 'then',
    'once', 'here', 'there', 'when', 'where', 'why', 'how', 'all', 'each',
    'every', 'both', 'few', 'more', 'most', 'other', 'some', 'such', 'no',
    'nor', 'not', 'only', 'own', 'same', 'so', 'than', 'too', 'very',
    'just', 'because', 'but', 'and', 'or', 'if', 'while', 'about', 'up',
    'that', 'this', 'these', 'those', 'it', 'its', 'my', 'me', 'i', 'we',
    'you', 'your', 'he', 'she', 'they', 'them', 'what', 'which', 'who',
    'whom', 'his', 'her', 'our', 'their', 'get', 'got', 'make', 'made',
    'using', 'use', 'new', 'like', 'also', 'one', 'two', 'help', 'please',
    'write', 'create', 'give', 'tell', 'let', 'know', 'think', 'see',
    'come', 'take', 'find', 'want', 'say', 'said', 'way', 'look',
    'going', 'back', 'much', 'still', 'even', 'well', 'right', 'any',
    'based', 'per', 'part', 'around', 'down', 'long', 'thing', 'things'
]);

// ----------------------------
// Word Cloud
// ----------------------------

function generateWordCloud(conversations) {
    if (!conversations || conversations.length === 0) return [];

    var wordCounts = {};

    for (var i = 0; i < conversations.length; i++) {
        var title = conversations[i].title;
        if (!title || title === 'Untitled' || title === '[deleted]') continue;

        // Split on non-alphanumeric, lowercase
        var words = title.toLowerCase().replace(/[^a-z0-9\s'-]/g, ' ').split(/\s+/);

        for (var j = 0; j < words.length; j++) {
            var word = words[j].replace(/^['-]+|['-]+$/g, ''); // trim leading/trailing punctuation
            if (word.length < 3) continue;
            if (STOP_WORDS.has(word)) continue;
            if (/^\d+$/.test(word)) continue; // skip pure numbers

            wordCounts[word] = (wordCounts[word] || 0) + 1;
        }
    }

    // Sort by frequency, take top 40
    var sorted = Object.keys(wordCounts).map(function(word) {
        return { word: word, count: wordCounts[word] };
    }).sort(function(a, b) {
        return b.count - a.count;
    }).slice(0, 40);

    if (sorted.length === 0) return [];

    var maxCount = sorted[0].count;
    var minCount = sorted[sorted.length - 1].count;
    var range = maxCount - minCount || 1;

    // Calculate font sizes (12px to 32px)
    for (var k = 0; k < sorted.length; k++) {
        var ratio = (sorted[k].count - minCount) / range;
        sorted[k].size = Math.round(12 + ratio * 20);
        // Opacity varies from 0.5 to 1.0
        sorted[k].opacity = (0.5 + ratio * 0.5).toFixed(2);
    }

    // Shuffle for visual variety (Fisher-Yates)
    for (var m = sorted.length - 1; m > 0; m--) {
        var n = Math.floor(Math.random() * (m + 1));
        var temp = sorted[m];
        sorted[m] = sorted[n];
        sorted[n] = temp;
    }

    return sorted;
}

function renderWordCloud(data, container) {
    if (!container) return;
    container.innerHTML = '';

    if (!data || data.length === 0) {
        container.innerHTML = '<span style="color: #555; font-size: 12px;">Not enough data for word cloud</span>';
        return;
    }

    for (var i = 0; i < data.length; i++) {
        var item = data[i];
        var span = document.createElement('span');
        span.className = 'word-cloud-word';
        span.textContent = item.word;
        span.style.fontSize = item.size + 'px';
        span.style.color = '#10a37f';
        span.style.opacity = item.opacity;
        span.title = item.word + ' (' + item.count + ')';
        container.appendChild(span);
    }
}

// ----------------------------
// Frequency Chart
// ----------------------------

function generateFrequencyData(conversations) {
    if (!conversations || conversations.length === 0) {
        return { dates: [], counts: [], maxCount: 0 };
    }

    // Group by date string (YYYY-MM-DD)
    var dayCounts = {};
    var minTime = Infinity;
    var maxTime = -Infinity;

    for (var i = 0; i < conversations.length; i++) {
        var ct = conversations[i].create_time;
        if (!ct) continue;

        // Handle both unix timestamps and ISO strings
        var ts = (typeof ct === 'number') ? ct * 1000 : new Date(ct).getTime();
        if (ts < 1000000000000) ts = ts * 1000; // seconds → milliseconds

        if (ts < minTime) minTime = ts;
        if (ts > maxTime) maxTime = ts;

        var d = new Date(ts);
        var key = d.getFullYear() + '-' +
            String(d.getMonth() + 1).padStart(2, '0') + '-' +
            String(d.getDate()).padStart(2, '0');

        dayCounts[key] = (dayCounts[key] || 0) + 1;
    }

    if (minTime === Infinity) {
        return { dates: [], counts: [], maxCount: 0 };
    }

    // Fill in all days from min to max
    var dates = [];
    var counts = [];
    var maxCount = 0;
    var current = new Date(minTime);
    current.setHours(0, 0, 0, 0);
    var end = new Date(maxTime);
    end.setHours(23, 59, 59, 999);

    while (current <= end) {
        var key = current.getFullYear() + '-' +
            String(current.getMonth() + 1).padStart(2, '0') + '-' +
            String(current.getDate()).padStart(2, '0');

        var count = dayCounts[key] || 0;
        dates.push(key);
        counts.push(count);
        if (count > maxCount) maxCount = count;

        current.setDate(current.getDate() + 1);
    }

    return { dates: dates, counts: counts, maxCount: maxCount };
}

function renderFrequencyChart(data, container) {
    if (!container) return;
    container.innerHTML = '';

    if (!data || data.dates.length === 0) {
        container.innerHTML = '<span style="color: #555; font-size: 12px;">Not enough data for chart</span>';
        return;
    }

    var barWidth = 2;
    var barGap = 3;
    var totalBars = data.dates.length;
    var chartHeight = 100;
    var bottomMargin = 20; // for month labels
    var topMargin = 10;
    var leftMargin = 4;
    var canvasWidth = Math.max(leftMargin + totalBars * (barWidth + barGap) + 10, 300);
    var canvasHeight = chartHeight + bottomMargin + topMargin;

    var canvas = document.createElement('canvas');
    canvas.width = canvasWidth * 2; // 2x for retina
    canvas.height = canvasHeight * 2;
    canvas.style.width = canvasWidth + 'px';
    canvas.style.height = canvasHeight + 'px';
    container.appendChild(canvas);

    var ctx = canvas.getContext('2d');
    ctx.scale(2, 2);

    // Background
    ctx.fillStyle = '#212121';
    ctx.fillRect(0, 0, canvasWidth, canvasHeight);

    // Subtle horizontal gridlines
    var gridLines = 4;
    ctx.strokeStyle = '#2a2a2a';
    ctx.lineWidth = 0.5;
    for (var g = 0; g <= gridLines; g++) {
        var gy = topMargin + (chartHeight / gridLines) * g;
        ctx.beginPath();
        ctx.moveTo(leftMargin, gy);
        ctx.lineTo(canvasWidth, gy);
        ctx.stroke();
    }

    // Draw bars
    var maxCount = data.maxCount || 1;
    var lastMonthLabel = '';

    for (var i = 0; i < totalBars; i++) {
        var count = data.counts[i];
        var barHeight = count > 0 ? Math.max(1, (count / maxCount) * chartHeight) : 0;
        var x = leftMargin + i * (barWidth + barGap);
        var y = topMargin + chartHeight - barHeight;

        if (count > 0) {
            // Opacity based on count relative to max
            var alpha = 0.3 + (count / maxCount) * 0.7;
            ctx.fillStyle = 'rgba(16, 163, 127, ' + alpha.toFixed(2) + ')';
            ctx.fillRect(x, y, barWidth, barHeight);
        }

        // Month labels on X axis
        var dateStr = data.dates[i];
        var monthLabel = dateStr.substring(0, 7); // YYYY-MM
        if (monthLabel !== lastMonthLabel) {
            lastMonthLabel = monthLabel;
            var monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
                              'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
            var monthNum = parseInt(dateStr.substring(5, 7)) - 1;
            var yearStr = dateStr.substring(2, 4);
            var label = monthNames[monthNum] + ' ' + yearStr;

            ctx.fillStyle = '#555';
            ctx.font = '9px ui-sans-serif, -apple-system, system-ui, sans-serif';
            ctx.textAlign = 'left';
            ctx.fillText(label, x, topMargin + chartHeight + 14);

            // Subtle tick mark
            ctx.strokeStyle = '#333';
            ctx.lineWidth = 0.5;
            ctx.beginPath();
            ctx.moveTo(x, topMargin + chartHeight);
            ctx.lineTo(x, topMargin + chartHeight + 4);
            ctx.stroke();
        }
    }

    // Y-axis max count label
    if (data.maxCount > 0) {
        ctx.fillStyle = '#555';
        ctx.font = '9px ui-sans-serif, -apple-system, system-ui, sans-serif';
        ctx.textAlign = 'left';
        ctx.fillText(data.maxCount.toString(), leftMargin, topMargin - 2);
    }
}

// ----------------------------
// Update analytics (called from popup.js)
// ----------------------------

function updateAnalytics(conversations) {
    var section = document.getElementById('analyticsSection');
    if (!section) return;

    if (!conversations || conversations.length < 5) {
        section.style.display = 'none';
        return;
    }

    // Frequency chart
    var freqData = generateFrequencyData(conversations);
    renderFrequencyChart(freqData, document.getElementById('frequencyChartContainer'));

    // Word cloud
    var wordData = generateWordCloud(conversations);
    renderWordCloud(wordData, document.getElementById('wordCloudContainer'));

    section.style.display = 'block';
}
