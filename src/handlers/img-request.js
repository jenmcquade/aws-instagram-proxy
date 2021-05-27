/**
 * FILE: img-request.js
 * Makes HTTP requests to Instagram image CDN and returns responses that are cross-domain friendly
 */

// To get responses using https calls
const axios = require ('axios');

/**
 * Event Handler referred to in template.yml
 * @param {*} event 
 * @param {*} context 
 * @returns 
 */
exports.imgRequestHandler = async (event, context) => {
	// headers.origin is only set when a request is made from another location
	// If there is an origin and it's an origin from ALLOWED_DOMAIN_ORIGINS env variable,
	//  allow processing the request
	// If there is an origin but it's not in the ALLOWED_DOMAIN_ORIGINS env variable,
	//  return a 403.
	// If there is no origin, then allow processing, and response data can be viewed directly
	let	env = {
		allowedOrigins: JSON.parse(process.env?.ALLOWED_DOMAIN_ORIGINS)?.origins,
		igProtocol: process.env?.IG_PROTOCOL || 'https',
		headersApiId: process.env?.HEADERS_API_ID,
		searchVals: event?.queryStringParameters
	}

	const origin = event.headers.Origin || event.headers.origin;
	let goodOrigin = false;
	if (origin) {
		env.allowedOrigins.forEach((allowedOrigin) => {
			if (!goodOrigin && origin.match(allowedOrigin)) {
				console.log('Allowed Origin: ', allowedOrigin);
				goodOrigin = true;
			} 
		});
		if (!goodOrigin) {
			let body = JSON.stringify({'Access Denied': 'Invalid origin domain'});
			console.log(body);
			return {
				'headers': {
					'content-type': 'application/json'
				},
				'body': body,
				'isBase64Encoded': false,
				'statusCode': 403
			}
		}
	}
	/**
	 * fetchData
	 * Builds an HTTP request to instagram's image CDN directly
	 * @returns Promise
	 */
	let fetchData = new Promise(async (resolve, reject) => {
		let re1 = new RegExp('=', 'g');
		let re2 = new RegExp('\\+', 'g');
		let re3 = new RegExp('\\/', 'g');

		let searchString = '';
		for (const [key, value] of Object.entries(env.searchVals)) {
			if(key !== 'url') {
				let newVal = value;
				newVal = newVal.replace(re1, '%3D');
				newVal = newVal.replace(re2, '%2B');
				newVal = newVal.replace(re3, '%2F');
				searchString += `&${key}=${newVal}`;
			}
		}

		let options = {
			host: env.searchVals._nc_ht,
			path: `/${env.searchVals.url}?${searchString}`,
			method: event.requestMethod,
			protocol: `${env.igProtocol}:`,
			rejectUnauthorized: false,
			followAllRedirects: true,
			headers: {
				Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.9',
				Connection: 'keep-alive',
			},
			responseType: 'arraybuffer'
		};

		let url = options.protocol + '//' + options.host + options.path;
		console.log('URL to call', url);
		
		resolve(await axios.get(url, options)
  		.then(response => Buffer.from(response.data, 'binary').toString('base64')));

	});

	/**
	 * fetchResponse is the request's HTTP response handler
	 *   Once fetchData Promise resolves, send back the full HTTP response with Cookie and Headers
	 */
	let fetchResponse = fetchData
		.then((success) => {
			let hardHeaders = {
				'content-type': 'image/jpeg',
				'cache-control': 'max-age=1209600, no-transform',
				'Access-Control-Allow-Headers':
					'Origin,X-Requested-With,Accept,Accept-Language,Content-Language,Content-Type,Authorization,x-correlation-id',
				'Access-Control-Expose-Headers': 'x-my-header-out',
				'Access-Control-Allow-Credentials': 'true',
				'Access-Control-Allow-Methods': 'OPTIONS,GET',
				'Access-Control-Allow-Origin': '*',
				'Api-Id': env.headersApiId,
				'cross-origin-resource-policy': 'cross-origin',
				'timing-allow-origin': '*'
			};
			let response = {
				isBase64Encoded: true,
				statusCode: 200,
				headers: hardHeaders,
				body: success
			};
			return response;
		})
		.catch((e) => {
			console.log('Error:', e.message);
		});
		// Completed Thenable actions

	return fetchResponse;
};

