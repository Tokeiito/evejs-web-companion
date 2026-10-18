// An owner's picture from the image server the game server names (eve/client/script/ui/services/evePhotosvc.py): the
// global config's 'imageserverurl', which a client has from its login (GetImageServerURL, 714 to 718), and
// RemoteImageCacher's address on it (744 to 772): the server's, with a slash after it, then the kind, "/<id>_<size>"
// and the suffix. Where the server names none the cacher cannot operate, and the client shows its default picture.

/** RemoteImageCacher's address for one picture; null where the server names no image server. */
export function remoteImageUrl(
  imageServer: string | null,
  cacheItem: "Alliance" | "Corporation" | "Character",
  itemID: number,
  size: number,
  suffix: ".png" | ".jpg",
): string | null {
  if (imageServer === null || !Number.isSafeInteger(itemID) || itemID <= 0) return null;
  // (An empty address is the cacher's own placeholder: 'http://xxx.dev.image/'.)
  let base = imageServer === "" ? "http://xxx.dev.image/" : imageServer.trim();
  if (!base.endsWith("/")) base += "/";
  return `${base}${cacheItem}/${itemID}_${size}${suffix}`;
}

/** photo.GetAllianceLogo(allianceID, 128): an alliance's logo as eveIcon.GetLogoIcon and GetOwnerLogo ask it. */
export function allianceLogoUrl(imageServer: string | null, allianceID: number): string | null {
  return remoteImageUrl(imageServer, "Alliance", allianceID, 128, ".png");
}
