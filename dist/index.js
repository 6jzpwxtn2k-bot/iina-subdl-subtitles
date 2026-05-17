// SubDL Altyazi Plugin for IINA v1.1 (fixed)
// API key: IINA → Preferences → Plugins → SubDL Subtitles → Preferences

var _subtitle    = iina.subtitle;
var _http        = iina.http;
var _core        = iina.core;
var _console     = iina.console;
var _event       = iina.event;
var _preferences = iina.preferences;

function getApiKey() {
  return _preferences.get("api_key") || "";
}

// Dosya adından film adı ve yıl çıkar
// "Inception.2010.1080p.BluRay.mkv" → { name:"Inception", year:"2010" }
function parseFilename(url) {
  var filename = url.replace(/.*\//, "").replace(/\.[^.]+$/, "");
  filename = filename.replace(/[._]/g, " ").trim();

  var yearMatch = filename.match(/\b(19|20)\d{2}\b/);
  var year = yearMatch ? yearMatch[0] : null;

  var name = filename;
  if (year) {
    var idx = filename.indexOf(year);
    if (idx > 0) {
      name = filename.slice(0, idx).trim();
    }
  }

  name = name.replace(
    /\b(1080p|720p|480p|4k|2160p|bluray|blu ray|webrip|web dl|web|hdtv|x264|x265|hevc|avc|remux|hdrip|dvdrip|bdrip)\b/gi,
    ""
  ).trim();

  return { name: name || filename, year: year };
}

// SubDL API araması
function searchSubDL(filmName, year, langCodes, onSuccess, onError) {
  var qs = "api_key=" + encodeURIComponent(getApiKey()) +
           "&film_name=" + encodeURIComponent(filmName) +
           "&languages=" + encodeURIComponent(langCodes) +
           "&subs_per_page=20";
  if (year) { qs += "&year=" + year; }

  var url = "https://api.subdl.com/api/v1/subtitles?" + qs;
  _console.log("[SubDL] GET " + url);

  _http.get(url, { headers: { "Accept": "application/json" } })
    .then(function(resp) {
      if (resp.statusCode !== 200) {
        onError("HTTP " + resp.statusCode);
        return;
      }
      var data;
      try { data = JSON.parse(resp.text); } catch(e) {
        onError("JSON parse: " + e);
        return;
      }
      if (!data.status) {
        onError("SubDL status false");
        return;
      }
      onSuccess(data.subtitles || []);
    })
    .catch(function(e) { onError("" + e); });
}

// Altyazı indir
function downloadSub(subUrl, onDone, onError) {
  var downloadUrl = "https://dl.subdl.com" + subUrl;
  _console.log("[SubDL] Download: " + downloadUrl);

  _http.download(downloadUrl, "@tmp/")
    .then(function(path) {
      _console.log("[SubDL] Saved: " + path);
      onDone(path);
    })
    .catch(function(e) { onError("" + e); });
}

// Provider'ları kaydet
var PROVIDERS = [
  { id: "subdl-tr",  codes: "TR",       label: "Türkçe"   },
  { id: "subdl-en",  codes: "EN",       label: "English"  },
  { id: "subdl-bg",  codes: "BG",       label: "Bulgarca" },
  { id: "subdl-all", codes: "TR,EN,BG", label: "TR+EN+BG" }
];

PROVIDERS.forEach(function(p) {
  _subtitle.registerProvider(p.id, {

    search: function() {
      return new Promise(function(resolve) {
        var url = _core.status.url || "";
        if (!url) { resolve([]); return; }

        var apiKey = getApiKey();
        if (!apiKey) {
          _console.error("[SubDL] API key girilmemis!");
          _core.osd("SubDL: Preferences → Plugins → SubDL → API Key girin");
          resolve([]);
          return;
        }

        var parsed = parseFilename(url);
        _console.log("[SubDL] Film: '" + parsed.name + "' Yil: " + (parsed.year || "?") + " Dil: " + p.codes);

        searchSubDL(
          parsed.name,
          parsed.year,
          p.codes,
          function(subs) {
            var items = subs.map(function(s) {
              return _subtitle.item({
                url:    s.url,
                name:   s.release_name || s.name || "Altyazi",
                lang:   s.lang || p.label,
                author: s.author || "",
                hi:     s.hi ? true : false
              });
            });
            _console.log("[SubDL] " + items.length + " sonuc bulundu");
            resolve(items);
          },
          function(err) {
            _console.error("[SubDL] Arama hatasi: " + err);
            resolve([]);
          }
        );
      });
    },

    description: function(item) {
      var d = item.data;
      var flags = d.hi ? " [HI]" : "";
      return {
        name:  (d.name || "Altyazi") + flags,
        left:  d.lang || p.label,
        right: d.author ? "by " + d.author : ""
      };
    },

    download: function(item) {
      return new Promise(function(resolve, reject) {
        downloadSub(
          item.data.url,
          function(path) { resolve([path]); },
          function(err)  { reject(new Error(err)); }
        );
      });
    }

  });

  _console.log("[SubDL] Provider kayitli: " + p.id);
});

_console.log("[SubDL] Plugin v1.1 hazir — TR / EN / BG");
