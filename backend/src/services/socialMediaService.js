function normalisePostUrl(value) {
  let url;
  try { url = new URL(value); } catch { throw new Error("Please enter a full Facebook or Instagram post URL."); }
  if (url.protocol !== "https:" || url.username || url.password) throw new Error("Please use a public HTTPS post URL.");
  const host = url.hostname.toLowerCase();
  if (["www.instagram.com", "instagram.com"].includes(host) && /^\/(p|reel)\/[A-Za-z0-9_-]+\/?$/.test(url.pathname)) {
    return { platform: "INSTAGRAM", url: `https://www.instagram.com${url.pathname.replace(/\/$/, "")}/` };
  }
  if (["www.facebook.com", "facebook.com", "m.facebook.com"].includes(host)) {
    if (/^\/WroughtonYFC\/posts\/[A-Za-z0-9_-]+\/?$/i.test(url.pathname)) {
      const id = url.pathname.split("/")[3];
      return { platform: "FACEBOOK", url: `https://www.facebook.com/WroughtonYFC/posts/${id}/` };
    }
    if (/^\/reel\/\d+\/?$/.test(url.pathname)) return { platform: "FACEBOOK", url: `https://www.facebook.com${url.pathname.replace(/\/$/, "")}/` };
  }
  throw new Error("Use a Facebook post from WroughtonYFC, a Facebook reel, or an Instagram post/reel permalink. Profile and shortened share links are not supported.");
}
module.exports = { normalisePostUrl };
