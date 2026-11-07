# Vutron Music - Mobile privacy information

Applies to **Vutron Music - Mobile**; implementation reviewed **2026-11-07**. Maintainer and source: **EBG-bg and contributors**, `https://github.com/EBG-bg/VutronMusic-Android`. Report privacy issues through the repository. Remove account credentials, signed media URLs and personal files before posting an issue or attachment.

## What the app handles

System backup and device-transfer rules include only named lyric, volume, cache-capacity, folder-selection and local-mode preference files. Sessions, plugin account storage, profiles, WebView data, music files, caches, scan indexes and update packages are excluded. Restoring folder references requires granting directory access again.

The separate manual JSON backup contains allowlisted settings and local playlist metadata, including volume, lyric offsets and custom order. The queue is saved as a metadata playlist; local-plugin favorites and playlists can be converted to the same recoverable metadata format. It excludes account credentials, cookies, plugin source contexts, media bytes, artwork caches, original absolute file paths and folder grants. Restore adds metadata playlists without replacing the current library; original folders or playlist bundles must be selected again to link audio. Ambiguous matches remain unavailable. The desktop export tool can use the desktop account session in memory through a loopback API to read online playlist metadata; it never includes the session in exported bundles.

- **Native NetEase session:** QR login or a cookie you explicitly enter creates a session for the native NetEase entry. Its `SessionStore` encrypts the stored cookie with AES-GCM using an Android Keystore key. The cookie is decrypted in process memory for authenticated service requests. This encryption statement applies to the native session, not every plugin account.
- **Plugin instances:** each instance keeps its server address, account/session data, settings and library records in app-private storage. The fields and storage format are defined by the plugin; the host does not provide a uniform encryption guarantee for these records. Native NetEase and plugin accounts are separate, as are accounts in different instances.
- **Profile and library:** account ID, nickname, avatar reference, playlists, track metadata, source associations, lyrics, artwork and playback history/progress are stored in the app's private files/preferences. Playlist and artwork snapshots permit offline browsing. Complete audio is cached automatically when audio caching is enabled, subject to capacity and availability.
- **Local music:** the Android system picker grants access to folders you select. Persisted folder URIs and an index of tags/durations are retained so the app can rescan and play them. A computer playlist ZIP you select is extracted into the app's private `local-bundles` directory. The importer reads its manifest/audio paths; it does not need your desktop account configuration.
- **Settings:** per-song/per-playlist volume, lyric delay, overlay colors and position, UI preferences, timers and the playback queue are saved locally.
- **Comments:** the native NetEase entry supports song comments. Plugin comments can cover tracks, albums, playlists or MVs when that source declares and implements the corresponding methods. Opening comments sends the resource and pagination details to the relevant service. Explicit likes, posts, replies and deletions use that instance's account; a post or reply sends its text. The host does not persist comment lists or drafts as an offline comment library. Network comment operations are disabled offline.
- **Playback speed and prefetch:** speed, pitch and the optional next-track prefetch preference are stored locally and included in settings backups. Prefetch defaults to off and runs only on validated Wi-Fi. It resolves the next known online source near the end of playback, holds the address and media headers briefly in memory, and does not download audio ahead.
- **Offline controls and cache index:** manual offline mode and a disconnected network pause music-provider requests, plugin network calls and alternative-source matching; local files and complete caches remain available. The absence of a native NetEase login alone does not prevent using a separately configured online source. A separate cache-owner index permits reading existing cached playlists after native sign-out; it is not an authenticated account session.
- **App updates:** the automatic-check preference is stored locally and defaults to off. Update metadata and a downloaded APK are held in private preferences/cache until replaced or no longer needed.
- **Diagnostics:** native, matcher and plugin-host events/errors may be logged on the device. The matcher wrapper uses fixed diagnostic fields, and the plugin host redacts common credential fields. This does not guarantee that every plugin, Android or service log is free of personal information. Review logs before sharing them.

## Network destinations and disclosure

The native NetEase entry sends login, library, search, lyric and playback requests to NetEase. Plugin instances send requests to their configured service or server. Artwork and audio are requested from the selected service/CDN URLs. Required cookies, tokens or media authentication headers accompany the relevant service requests. Those services receive ordinary network information such as your IP address, requested resource, headers and request time.

Listing sources or switching an instance on does not execute its plugin or probe its server. Opening a source, signing in or explicitly reading its data runs it as needed. Imported JavaScript is executed for validation and plugin operations using the host's exposed networking, storage and authorized local-music capabilities. Only import scripts you trust; compatibility with the plugin protocol is not a security guarantee.

Emby, Jellyfin and Navidrome use the server you configure; the Kugou connection requires a compatible API service. A configured self-hosted server can be on your private network and can use HTTP. Its authenticated media route is restricted to that configured server origin. HTTP does not provide the transport protection of HTTPS.

When alternative-source matching is enabled, the embedded JavaScript matcher may contact **bodian, kuwo, kugou, qq, bilibili, pyncmd and migu**, including their metadata services. Queries can disclose song identifiers, title, artist, album, duration and ordinary network information to those providers. The matcher wrapper does **not** accept the native NetEase account cookie. Matching runs locally in the app, rather than on a maintainer-operated matching server. The shipped playback source policy identifies the active candidates. The embedded bridge binds only to `127.0.0.1` with a per-process token.

The reviewed Mobile code has no maintainer-operated account database, advertising or analytics upload endpoint. Music providers, self-hosted services and imported scripts have their own implementations and data handling.

The manifest permits network access. Native cleartext exceptions cover loopback and the NetEase artwork CDN. Some HTTP audio travels through a private loopback stream gateway; this does not make the external route HTTPS. The legacy matcher's general media gateway rejects private-network targets and does not receive the native account cookie. A separate plugin media route can forward the authentication required by an explicitly configured server, including LAN/HTTP servers. The legacy gateway restrictions therefore do not describe every plugin connection.

## App updates

App updates use the GitHub Releases API for EBG-bg/VutronMusic-Android after a manual check or when automatic checks are enabled. Automatic checks default to off and pause in local-only mode, including on startup and resume. The archived repository is not queried or accepted for update downloads. GitHub and its release-asset CDN receive ordinary request metadata, including IP address and app-version User-Agent. The app's update requests do not attach music-account cookies or media credentials; those credentials are used with the relevant music service, not the GitHub update check. APK downloads use HTTPS and verify the release asset's SHA-256, size, package, version and signing certificate. An explicit manual check still connects to GitHub.

## Permissions

- **Internet / network state:** direct service calls, media/artwork downloads and Wi-Fi-aware lyric validation.
- **Install packages:** used only to open Android's installer for a verified update you request. Android controls the per-app installation permission and final confirmation; the app does not silently install APKs.
- **Foreground playback / wake lock / notifications:** background music, playback controls and the timer/service status.
- **Draw over other apps:** only for the desktop lyric overlay you enable. Locked overlays may be limited by Android's touch-obscuring/security rules; sensitive windows can hide them.
- **System folder picker grants:** only folders/documents selected through Android's picker; no need to provide an entire device export.

The app does not ask for microphone, camera, contacts or location access for these features. QR codes are generated for display; scanning takes place in your chosen service client.

## Your controls and deletion

- Sign out of the native NetEase entry to remove its stored session and login profile state. This does not sign out independent plugin instances or delete local music, caches, imported bundles, folder grants or preferences.
- Disable a plugin instance to stop its worker and calls. Disabling does not delete its saved configuration, the main local library or shared audio/artwork/lyric caches. Clearing plugin data resets the current instance's active storage; deleting an external plugin removes its current records and script. These actions do not promise secure erasure of other retained migration/recovery copies.
- Use cache settings to disable automatic audio caching, adjust capacity, remove individual cached audio or clear app-managed caches. Cache removal does not delete original files in a selected music folder.
- Disable/temporarily hide the lyric overlay or revoke Android's overlay permission. Revoke folder access through Android's app/storage controls as supported by your device.
- Android's **Clear storage** or uninstall removes the app's private state under Android's rules. Original user-selected files are not app-owned copies and are not removed by these actions. Device backup/restore behavior follows the installed manifest and Android implementation.

There is no maintainer-side account database to request deletion from. Information held independently by NetEase or other providers must be managed through the relevant provider. When asking for support, share only the minimum metadata needed to reproduce an issue.
