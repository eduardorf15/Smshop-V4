export function cacheFor(seconds) {
  return (_req, res, next) => {
    res.set("Cache-Control", `public, max-age=${seconds}`);
    next();
  };
}
