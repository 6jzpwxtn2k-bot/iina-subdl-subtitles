// SubDL Altyazi Plugin for IINA
// Yazar: 6jzpwxtn2k-bot
//
// API key IINA icerisinden girilir:
// Preferences → Plugins → SubDL Subtitles → Preferences sekmesi

// -----------------------------------------------------------
// IINA modülleri
// -----------------------------------------------------------
var _subtitle    = iina.subtitle;
var _http        = iina.http;
var _core        = iina.core;
var _console     = iina.console;
var _utils       = iina.utils;
var _event       = iina.event;
var _preferences = iina.preferences;

// API key'i her aramada preferences'tan oku
function getApiKey() {
  return _preferences.get("api_key") || "";
}

_console.log("SubDL plugin loaded");

// -----------------------------------------------------------
// Yardimci: dosya adından film adi ve yil çikar
// Örnek: "Inception.2010.1080p.BluRay.mkv" → { name:"Inception", year:"2010" }
// -----------------------------------------------------------
function parseFilename(url) {
  var filename = url.replace(/.*\//, "").replace(/\.[^.]+$/, "");
  filename = filename.replace(/[._]/g, " ").trim();

  var yearMatch = filename.match(/\b(19|20)\d{2}\b/);
  var year = yearMatch ? yearMatch[0] : null;

  var name = filename;
  if (year) {
    var idx = filename.indexOf(year);
    if (idx > 0) name = filename.slice(0, idx).trim();
  }

  // Kalite etiketlerini temizle
  name = name.replace(
    /\b(1080p|720p|480p|4k|2160p|bluray|blu ray|webrip|web dl|web|hdtv|x264|x265|hevc|avc|remux|hdrip|dvdrip|bdrip)\b/gi,
    ""
  ).trim();

  return { name: name || filename, year: year };
}

// -----------------------------------------------------------
// SubDL API araması — callback tabanlı (Promise yok)
// -----------------------------------------------------------
function searchSubDL(filmName, year, langCodes, onSuccess, onError) {
  var qs = "api_key="    + encodeURIComponent(getApiKey()) +
           "&film_name=" + encodeURIComponent(filmName) +
           "&languages=" + encodeURIComponent(langCodes) +
           "&subs_per_page=20";
  if (year) qs += "&year=" + year;

  var url = "https://api.subdl.com/api/v1/subtitles?" + qs;
  _console.log("[SubDL] GET " + url);

  _http.get(url, {}, {}).then(function(resp) {
    if (resp.statusCode !== 200) {
      _console.error("[SubDL] HTTP " + resp.statusCode);
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
  }).catch(function(e) {
    onError("" + e);
  });
}

// -----------------------------------------------------------
// Altyazi indir — zip içinden ilk SRT/ASS dosyasini çikar
// -----------------------------------------------------------
function downloadSub(subUrl, onDone, onError) {
  var downloadUrl = "https://dl.subdl.com" + subUrl;
  _console.log("[SubDL] Download: " + downloadUrl);

  _http.download(downloadUrl).then(function(resp) {
    var path = resp.path || resp;
    _console.log("[SubDL] Saved: " + path);
    onDone(path);
  }).catch(function(e) {
    onError("" + e);
  });
}

// -----------------------------------------------------------
// Her provider'i kaydet
// -----------------------------------------------------------
var PROVIDERS = [
  { id: "subdl-tr",  codes: "TR",       label: "Türkçe"    },
  { id: "subdl-en",  codes: "EN",       label: "English"   },
  { id: "subdl-bg",  codes: "BG",       label: "Bulgarca"  },
  { id: "subdl-all", codes: "TR,EN,BG", label: "TR+EN+BG"  }
];

PROVIDERS.forEach(function(p) {
  _subtitle.registerProvider(p.id, {

    // IINA "Find Online Subtitles" açildiginda çagrilir
    search: function() {
      return new Promise(function(resolve) {
        var url = _core.status.url || "";
        if (!url) { resolve([]); return; }

        var apiKey = getApiKey();
        if (!apiKey) {
          _console.error("[SubDL] API key girilmemis! IINA → Preferences → Plugins → SubDL → Preferences");
          _core.osd("SubDL: Lutfen once API key'i ayarlarin (Preferences → Plugins → SubDL → Preferences)");
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
            _console.log("[SubDL] " + items.length + " sonuç bulundu");
            resolve(items);
          },
          function(err) {
            _console.error("[SubDL] Arama hatasi: " + err);
            resolve([]);
          }
        );
      });
    },

    // Listede her satir için gösterilecek etiketler
    description: function(item) {
      var d = item.data;
      var flags = d.hi ? " [HI]" : "";
      return {
        name:  (d.name || "Altyazi") + flags,
        left:  d.lang || p.label,
        right: d.author ? "by " + d.author : ""
      };
    },

    // Kullanici seçim yapinca çagrilir
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
