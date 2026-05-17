// SubDL + DeepL Altyazi Plugin for IINA
// SubDL ile altyazi indir, DeepL ile mevcut altyaziyi cevir

var _subtitle    = iina.subtitle;
var _http        = iina.http;
var _core        = iina.core;
var _console     = iina.console;
var _event       = iina.event;
var _preferences = iina.preferences;
var _mpv         = iina.mpv;
var _file        = iina.file;

function getSubDLKey() {
  return _preferences.get("api_key") || "";
}

function getDeepLKey() {
  return _preferences.get("deepl_key") || "";
}

// --- Dosya adindan film adi ve yil cikar ---
function parseFilename(url) {
  var filename = url.replace(/.*\//, "").replace(/\.[^.]+$/, "");
  filename = filename.replace(/[._]/g, " ").trim();
  var yearMatch = filename.match(/\b(19|20)\d{2}\b/);
  var year = yearMatch ? yearMatch[0] : null;
  var name = filename;
  if (year) {
    var idx = filename.indexOf(year);
    if (idx > 0) name = filename.slice(0, idx).trim();
    name = name.replace(/\b(1080p|720p|480p|4k|2160p|bluray|blu ray|webrip|web dl|web|hdtv|x264|x265|hevc|avc|remux|hdrip|dvdrip|bdrip)\b/gi, "").trim();
  }
  return { name: name || filename, year: year };
}

// --- SubDL API aramasi ---
function searchSubDL(filmName, year, langCodes, onSuccess, onError) {
  var qs = "apikey=" + encodeURIComponent(getSubDLKey())
         + "&film_name=" + encodeURIComponent(filmName)
         + "&languages=" + encodeURIComponent(langCodes)
         + "&subs_per_page=20";
  if (year) qs += "&year=" + year;
  var url = "https://api.subdl.com/api/v1/subtitles?" + qs;
  _http.get(url, {}).then(function(resp) {
    if (resp.statusCode !== 200) { onError("HTTP " + resp.statusCode); return; }
    var data;
    try { data = JSON.parse(resp.text); } catch(e) { onError("JSON parse: " + e); return; }
    if (!data.status) { onError("SubDL status false"); return; }
    onSuccess(data.subtitles);
  }).catch(function(e) { onError(e); });
}

// --- Altyazi indir ---
function downloadSub(subUrl, onDone, onError) {
  var downloadUrl = "https://dl.subdl.com" + subUrl;
  _http.download(downloadUrl).then(function(resp) {
    onDone(resp.path || resp);
  }).catch(function(e) { onError(e); });
}

// ============================================================
// DEEPL CEVIRI FONKSIYONLARI
// ============================================================

function parseSRT(text) {
  var blocks = text.trim().replace(/\r\n/g, "\n").split(/\n\n+/);
  var entries = [];
  for (var i = 0; i < blocks.length; i++) {
    var lines = blocks[i].split("\n");
    if (lines.length < 3) continue;
    entries.push({
      index: lines[0].trim(),
      timing: lines[1].trim(),
      text: lines.slice(2).join("\n")
    });
  }
  return entries;
}

function buildSRT(entries) {
  return entries.map(function(e) {
    return e.index + "\n" + e.timing + "\n" + e.text;
  }).join("\n\n") + "\n";
}

function stripTags(str) {
  return str.replace(/<[^>]*>/g, "");
}

function getSubtitlePath() {
  try {
    var sid = _mpv.getProperty("sid");
    if (!sid || sid === "no") return null;
    var count = parseInt(_mpv.getProperty("track-list/count")) || 0;
    for (var i = 0; i < count; i++) {
      if (_mpv.getProperty("track-list/" + i + "/type") !== "sub") continue;
      if (_mpv.getProperty("track-list/" + i + "/selected") !== "yes") continue;
      var p = _mpv.getProperty("track-list/" + i + "/external-filename");
      if (p) return p;
    }
  } catch(e) { _console.log("getSubtitlePath err: " + e); }
  return null;
}

async function translateBatch(texts, targetLang, apiKey) {
  var BATCH = 50;
  var translated = [];
  for (var i = 0; i < texts.length; i += BATCH) {
    var batch = texts.slice(i, i + BATCH);
    var body = batch.map(function(t) {
      return "text=" + encodeURIComponent(t);
    }).join("&") + "&target_lang=" + targetLang;
    var res = await _http.post("https://api-free.deepl.com/v2/translate", {
      headers: {
        "Authorization": "DeepL-Auth-Key " + apiKey,
        "Content-Type": "application/x-www-form-urlencoded"
      },
      body: body
    });
    var data = JSON.parse(res.text);
    if (!data.translations) throw new Error("DeepL: " + res.text);
    data.translations.forEach(function(t) { translated.push(t.text); });
  }
  return translated;
}

async function doDeepLTranslate(targetLang, langLabel) {
  var apiKey = getDeepLKey();
  if (!apiKey) {
    _core.osd("DeepL: Once Preferences'dan API key girin!");
    return [];
  }
  var trackPath = getSubtitlePath();
  if (!trackPath) {
    _core.osd("DeepL: Once harici .srt altyazi yukleyin!");
    return [];
  }
  _core.osd("DeepL: " + langLabel + " icin ceviri basliyor...");
  try {
    var srtContent = _file.read(trackPath);
    var entries = parseSRT(srtContent);
    if (!entries.length) {
      _core.osd("DeepL: Altyazi dosyasi okunamadi.");
      return [];
    }
    var texts = entries.map(function(e) { return stripTags(e.text); });
    var translated = await translateBatch(texts, targetLang, apiKey);
    var newEntries = entries.map(function(e, i) {
      return { index: e.index, timing: e.timing, text: translated[i] || e.text };
    });
    var newSRT = buildSRT(newEntries);
    var outPath = "@tmp/deepl_" + targetLang.toLowerCase() + "_" + Date.now() + ".srt";
    _file.write(outPath, newSRT);
    _core.osd("DeepL: " + langLabel + " altyazi hazir!");
    // subtitle.item olarak geri don - kullanici secince yuklenecek
    return [_subtitle.item(outPath, {
      name: "[DeepL] " + langLabel + " Cevirisi",
      lang: langLabel,
      author: "DeepL"
    })];
  } catch(err) {
    _core.osd("DeepL Hata: " + err.message);
    _console.log("DeepL error: " + err);
    return [];
  }
}

// ============================================================
// SUBDL PROVIDER'LARI
// ============================================================

var PROVIDERS = [
  { id: "subdl-tr",  codes: "TR",       label: "Turkce"   },
  { id: "subdl-en",  codes: "EN",       label: "English"  },
  { id: "subdl-bg",  codes: "BG",       label: "Bulgarca" },
  { id: "subdl-all", codes: "TR,EN,BG", label: "TR+EN+BG" }
];

PROVIDERS.forEach(function(p) {
  _subtitle.registerProvider(p.id, {
    search: function() {
      return new Promise(function(resolve) {
        var url = _core.status.url;
        if (!url) { resolve([]); return; }
        var apiKey = getSubDLKey();
        if (!apiKey) {
          _core.osd("SubDL: Preferences'dan API key girin!");
          resolve([]); return;
        }
        var parsed = parseFilename(url);
        searchSubDL(parsed.name, parsed.year, p.codes, function(subs) {
          var items = subs.map(function(s) {
            return _subtitle.item(s.url, {
              name: s.release_name || s.name || "Altyazi",
              lang: p.label,
              author: s.author
            });
          });
          resolve(items);
        }, function(err) {
          _console.log("SubDL arama hatasi: " + err);
          resolve([]);
        });
      });
    },
    description: function(item) {
      var d = item.data;
      return {
        name: (d.name || "Altyazi") + (d.hi ? " [HI]" : ""),
        left: p.label,
        right: d.author ? "by " + d.author : ""
      };
    },
    download: function(item) {
      return new Promise(function(resolve, reject) {
        downloadSub(item.data.url, function(path) {
          resolve(path);
        }, function(err) {
          reject(new Error(err));
        });
      });
    }
  });
});

// ============================================================
// DEEPL PROVIDER'LARI
// ============================================================

var DEEPL_PROVIDERS = [
  { id: "deepl-tr", lang: "TR", label: "Turkce" },
  { id: "deepl-bg", lang: "BG", label: "Bulgarca" }
];

DEEPL_PROVIDERS.forEach(function(p) {
  _subtitle.registerProvider(p.id, {
    search: function() {
      return doDeepLTranslate(p.lang, p.label);
    },
    description: function(item) {
      return {
        name: item.data.name || ("DeepL " + p.label),
        left: p.label,
        right: "DeepL"
      };
    },
    download: function(item) {
      return Promise.resolve(item.data.url);
    }
  });
});

_console.log("SubDL + DeepL plugin yuklu.");
