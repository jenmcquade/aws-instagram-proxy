/**
 * FILE: ig-request.js
 * Makes HTTP requests to Instagram and returns responses that are cross-domain friendly
 */

// To get responses using https calls
const https = require('https');
const url = require('url');

/**
 * Event Handler referred to in template.yml
 * @param {*} event 
 * @param {*} context 
 * @returns 
 */
exports.igRequestHandler = async (event, context) => {
	// Environment Variables with some default values
	let env = {
		allowedOrigins: JSON.parse(process.env?.ALLOWED_DOMAIN_ORIGINS)?.origins,
		apiMapping: process.env?.API_MAPPING || '',
		igSearchPath: process.env?.IG_SEARCH_PATH || '/graphql/query',
		igProtocol: process.env?.IG_PROTOCOL || 'https',
		imgProtocol: process.env?.IMG_SERVICE_PROTOCOL || 'http',
		imgServicePath : process.env?.IMG_SERVICE_BASE_PATH || '/img',
		igSessionId: process.env?.IG_SESSION_ID,
		igTagQueryHash: process.env?.IG_TAG_QUERY_HASH || '298b92c8d7cad703f7565aa892ede943',
		igUserQueryHash: process.env?.IG_USER_QUERY_HASH || '472f257a40c653c64c666ce877d59d2b',
		igReturnFirst: process.env?.IG_RETURN_FIRST || 20,
		igCookieDomain: process.env?.IG_COOKIE_DOMAIN || 'instagram.com',
		igHostDomain: process.env?.IG_HOST_DOMAIN || 'www.instagram.com',
		cookieDomain: process.env?.COOKIE_DOMAIN,
		headersApiId: process.env?.HEADERS_API_ID,
		stageId: !String(event.headers.Host).includes('localhost') ? '/' + process.env?.STAGE_ID : '',
		igQueryString: '',
		igSearchVariables: ''
	};
	
	/**
	 * formatImageUrls
	 * Format Instagram urls to return proxy values instead
	 * @param string preformattedBody 
	 * @returns string formattedBody
	 */
	const formatImageUrls = function(preformattedBody) {
		let re1 = new RegExp('\\/', 'g');
		let re2 = new RegExp('\\?', 'g');
		let bodyAsArray = preformattedBody.split('"');
		for(let i=0; i < bodyAsArray.length - 1; i++) {
			// Loop through all nodes and format them if they're image or movie urls
			if(bodyAsArray[i].startsWith('http') && bodyAsArray[i].indexOf('.jpg') !== -1) {
				let thisUrl = new url.URL(bodyAsArray[i]);
				let gatewayPath = env.apiMapping !== '' ? env.apiMapping : env.stageId;
				let pathAsQs = thisUrl.pathname; // Get the old URL path so we can pass it in as query string items
				thisUrl.protocol = env.imgProtocol; // set the new URL protocol to the proxy server's protocol
				thisUrl.host = event.headers?.Host;
				thisUrl.pathname = gatewayPath + env.imgServicePath; // set the new URL path to the api path
				thisUrl.search = '?url=' + pathAsQs + thisUrl.search; // Prepend the path to the query string
				thisUrl.search = thisUrl.search.replace(re1, '%2F') // Replace any '/' in querystring with '%2F'
				thisUrl.search = thisUrl.search.replace(re2, '&') // Replace any '?' in querystring with '&'
				bodyAsArray[i] = url.format(thisUrl);
			} 
		}
		let newBody = bodyAsArray.join('"');
		return newBody;
	}

	/**
	* Modify the search path to instagram.com based on path parameters
	*/
	switch (event?.pathParameters?.type) {
		case 'tag':
			env.igSearchVariables = {
				hash: env.igTagQueryHash,
				tag_name: event?.pathParameters?.value,
				first: env.igReturnFirst,
				after: event.queryStringParameters?.after
			};
			break;
		case 'user':
			env.igSearchVariables = {
				hash: env.igUserQueryHash,
				id: event?.pathParameters?.value,
				first: env.igReturnFirst,
				after: event.queryStringParameters?.after
			};
			break;
		default:
			env.igSearchVariables = {
				hash: env.igTagQueryHash,
				tag_name: 'catsofig',
				first: env.igReturnFirst,
				after: event.queryStringParameters?.after
			};
	}

	/**
	 * Create the query string path
	 */
	env.igQueryString = `query_hash=${env.igSearchVariables.hash}&variables=${JSON.stringify(env.igSearchVariables)}`

	// headers.origin is only set when a request is made from another location
	// If there is an origin and it's an origin from ALLOWED_DOMAIN_ORIGINS env variable,
	//  allow processing the request
	// If there is an origin but it's not in the ALLOWED_DOMAIN_ORIGINS env variable,
	//  return a 403.
	// If there is no origin, then allow processing, and response data can be viewed directly
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
				'body': body,
				'isBase64Encoded': false,
				'statusCode': 403
			}
		}
	}

	/**
	 * fetchData
	 * Builds an HTTP request to instagram.com directly
	 * @returns Promise
	 */
	let fetchData = new Promise((resolve, reject) => {
		let options = {
			host: `${env.igHostDomain}`,
			path: `${env.igSearchPath}/?${env.igQueryString}`,
			method: 'GET',
			protocol: `${env.igProtocol}:`,
			rejectUnauthorized: false,
			followAllRedirects: true,
			headers: {
				cookie: `sessionid=${env.igSessionId};`,
			},
		};

		let url = options.protocol + '//' + options.host + options.path;
		console.log('URL to call', url);

		/**
		 * reqLoop
		 * A recursive means to follow 301 redirects to their origin, 
		 *  then return the response from the origin
		 * @param string url 
		 * @param object options 
		 * @param object resolve 
		 */
		const reqLoop = function (url, options, resolve) {
			const req = https.request(url, options, (res) => {
				if (
					res.statusCode > 300 &&
					res.statusCode < 400 &&
					res.headers?.location
				) {
					console.log('Reponse Status Code', res.statusCode);
					delete options.host;
					delete options.path;
					reqLoop(res.headers.location, options, resolve);
				} else {
					let data = '';

					// A chunk of data has been recieved.
					res.on('data', (chunk) => {
						data += chunk;
					});

					// The whole response has been received. 
					res.on('end', () => {
						resolve({ res, data });
					});
				}
			});
			if (req) {
				req.write('');
				req.end();
			}
		};
		reqLoop(url, options, resolve);
	});

	/**
	 * fetchResponse is the request's HTTP response handler
	 *   Once fetchData Promise resolves, send back the full HTTP response with Cookie and Headers
	 */
	let fetchResponse = fetchData
		.then((success) => {
			console.log('Status Code', success.res.statusCode);
			console.log('Successful data returned: ', success.data.substring(1, 200) + '...');
			let newData = formatImageUrls(success.data);
			// Replace domain name in cookies
			if (success.res.headers['set-cookie']) {
				for (let i = 0; i < success.res.headers['set-cookie'].length; i++) {
					success.res.headers['set-cookie'][i] = success.res.headers[
						'set-cookie'
					][i].replace(env.igCookieDomain, env.cookieDomain);
				}
			}
			let hardHeaders = {
				'Content-Type': 'application/json',
				'Access-Control-Allow-Headers':
					'Accept,Accept-Language,Content-Language,Content-Type,Authorization,x-correlation-id',
				'Access-Control-Expose-Headers': 'x-my-header-out',
				'Access-Control-Allow-Credentials': 'true',
				'Access-Control-Allow-Methods': 'OPTIONS,GET',
				'Access-Control-Allow-Origin': origin,
				'Api-Id': env.headersApiId,
			};
			let responseBody = {
				graphql: JSON.parse(newData).data
			};
			let response = {
				isBase64Encoded: false,
				statusCode: 200,
				headers: hardHeaders,
				multiValueHeaders: {
					'set-cookie': success.res.headers['set-cookie'],
					location: [success.res.headers['location']],
					vary: [success.res.headers['vary']],
					'x-frame-options': [success.res.headers['x-frame-options']],
					'x-content-type-options': [
						success.res.headers['x-content-type-options'],
					],
					sniff: [success.res.headers['sniff']],
					'access-control-expose-headers': [
						success.res.headers['access-control-expose-headers'],
					],
				},
				body: JSON.stringify(responseBody),
			};
			return response;
		})
		.catch((e) => {
			console.log('Error:', e.message);
		});
		// Completed Thenable actions

	return fetchResponse;
};

