// sample script
addEventListener("fetch", event => {
  event.respondWith(handleRequest(event.request));
});

/**
 * Fetch and return the request body
 * @param {Request} request
 */
async function handleRequest(request) {
  // Wrap your script in a try/catch and return the error stack to view error information
  try {
	  
    /* Modify request here before sending it with fetch */
    const userAgent = request.headers.get('User-Agent');
    
    /* Send requests */
    // 1) Consult the DDR microservice in regards to the user agent
    // 2) Fetch response from upstream
    var deviceData, response;
    [deviceData, response] = await Promise.all([getDeviceData(userAgent), fetch(request)]);
    
    const upstreamContent = await response.text();

    /* Parse Master Playlist into a list of variants */
    var variants = parseM3u8(upstreamContent);
    /* Decide how to modify the variant list based on device */
    var config = decisionTree(deviceData, variants);
    /* Sort and format available qualities accordingly */
    var output = writeSortedManifest(variants, config)


    /* Return modified response */
	  // Calculate new content size (beware UTF-8)
	response.headers.set("Content-Length", output.length);
	
    return new Response(output, {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers
    });
	
    return response;
  } catch (e) {
    return new Response(e.stack || e, { status: 500 });
  }
}

async function getDeviceData(ua) {
  try {
    /** IMPORTANT **/
    /** Please Replace The URL Below With the Address for Your OpenDDR Container *******/
    const res = await fetch('http://openddr.demo.jelastic.com/servlet/classify?ua='+ua);
    /***********************************************************************************/
    const data = await res.json();
    return data.result.attributes;
  } catch (e) {
    throw new Error('DDR communication failed')
  }
}

function parseM3u8(body) {
  // Parse M3U8 manifest into an object array, containing bitrate, resolution, and codec info
  var regex = /^#EXT-X-STREAM-INF:BANDWIDTH=(\d+)(?:,RESOLUTION=(\d+x\d+))?,?(.*)\r?\n(.*)$/gm;
  var qualities = [];
  while ((match = regex.exec(body)) != null) {
    qualities.push({bitrate: parseInt(match[1]), resolution: match[2], playlist: match[4], codec: match[3]});
  }
  return qualities;
}

function writeSortedManifest(qualities, config) {
  // Sort qualities, optionally cap at a certain resolution, and rewrite into HLS manifest syntax
  // config = {cap: bool, top: int, res: int}
  // top = 1: highest quality first, 2: highest quality within res or next one if >4Mbps, 0: middle quality first, -1: lowest quality first

  //cap
  //remove qualities with a resolution higher than a certain value (player resolution) 
  if (config.cap) {
    newQualities = qualities.filter((x)=> Math.max.apply({},x.resolution.split('x')) <= config.res );
	// anything left?
	if (newQualities.length > 0)
		qualities = newQualities;
  }

  // sort array so either best or worst quality is the first
  // dir = 1 for descending, -1 for ascending. use 1 for anything except top==-1
  // if top==-1, this is all we need to do
  var dir = config.top==-1 ? -1: 1;
  qualities.sort((a,b) => (a.bitrate>b.bitrate)? -1*dir: dir)
  
  //if applying resolution rule (top==2), process from top to bottom to find variant satisfying conditions
  if (config.top==2) {
	for (var i in qualities) {
		//let's assume it's this one
		var topChoice = qualities[i];
		
		// convert "1280x720" to 1280; accomodate top dimension and the rest will be fine if using a sane aspect ratio
		var topDim = qualities[i].resolution.split('x').sort()[1];
		
		// For this variant:
		// is res <= display?
		if (topDim <= config.res) {
			// yes! but is bitrate <4Mbps?
			if (qualities[i].bitrate < 4000000) {
				// great! done here.
				break;
			}
			else if (qualities.length>i) {
				//it's not, so choose next option if it exists
				i++;
				topChoice = qualities[i];
				break;
			}
			else {
				// next option doesn't exist? ok, fine. We'll take the current one
				break;
			}
		}
	}
	// Now let's move the top choice top
	qualities.splice(i,1);
	qualities.splice(0,0,topChoice);
  }
  
  //if middle quality required to be the first, move it there
  if (config.top==0) {
    var m = Math.floor(qualities.length/2);
    var middleItem = qualities[m];
    qualities.splice(m,1);
    qualities.splice(0,0,middleItem); 
  }
    
  //create string output
  const header = "#EXTM3U\n#EXT-X-VERSION:3\n";
  var output = header + qualities.map((q) => ["#EXT-X-STREAM-INF:BANDWIDTH=",q.bitrate,",RESOLUTION=",q.resolution,q.codec ? ","+q.codec : "",'\n',q.playlist].join('')).join('\n')
  return output;
}

function decisionTree(deviceData, qualities) {
  /* Logic deciding on ordering and capping of available qualities */
  /* Returns config object to the spec of the output function above */
  
  // get higher dimension of resolution
  var res = Math.max.apply({},[deviceData.displayHeight,deviceData.displayWidth]);
  //is it a desktop device? assume 1280x720. Note is_desktop is a string, not a bool
  if (deviceData.is_desktop == "true")
	  return {top: 2, cap: false, res: 1280};
  else {
	  // mobile device. Is it an old device?
	  if ((deviceData.device_os == "iOS" && parseInt(deviceData.device_os_version) < 7) || (deviceData.device_os == "Android" && parseInt(deviceData.device_os_version) < 6) || (deviceData['release-year'] < 2012))
		 return {top: -1, cap: true, res: res}; 
	 else 
		 return {top: 2, cap: false, res: res}; 
  }

  //default
  return {top: 2, cap: false, res: res}
}
