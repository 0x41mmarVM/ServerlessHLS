// sample script
addEventListener("fetch", event => {
  event.respondWith(handleRequest(event.request));
});

/**
 * Fetch and return the request body
 * @param {Request} request
 */
async function handleRequest(request) {
  try {
    /* Modify request here before sending it with fetch */

    let response = await fetch(request);

    /* Modify response here before returning it */

    return response;
  } catch (e) {
    return new Response(e.stack || e, { status: 500 });
  }
}
