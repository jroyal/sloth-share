/**
 * Share Stuff - A simple file sharing service using Cloudflare Workers and R2
 */

// List of common English words for generating readable file keys
const WORDS = [
	'apple', 'banana', 'orange', 'grape', 'melon', 'lemon', 'peach', 'plum', 'cherry', 'berry',
	'horse', 'tiger', 'lion', 'zebra', 'panda', 'koala', 'eagle', 'hawk', 'wolf', 'bear',
	'river', 'ocean', 'lake', 'mountain', 'valley', 'hill', 'forest', 'desert', 'island', 'beach',
	'blue', 'green', 'red', 'yellow', 'purple', 'orange', 'pink', 'brown', 'white', 'black',
	'sun', 'moon', 'star', 'cloud', 'rain', 'snow', 'wind', 'storm', 'thunder', 'lightning',
	'gold', 'silver', 'bronze', 'iron', 'steel', 'copper', 'tin', 'lead', 'zinc', 'nickel',
	'book', 'page', 'story', 'tale', 'poem', 'song', 'music', 'art', 'paint', 'dance',
	'chair', 'table', 'desk', 'bed', 'sofa', 'lamp', 'clock', 'door', 'window', 'floor'
];

// File types that should be rendered in the browser
const RENDERABLE_TYPES = [
	'image/jpeg',
	'image/png',
	'image/gif',
	'image/svg+xml',
	'image/webp',
	'application/pdf',
	'text/plain',
	'text/html',
	'text/css',
	'text/javascript',
	'application/json',
	'video/mp4',
	'audio/mpeg',
	'audio/wav'
];

export default {
	async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
		const url = new URL(request.url);
		const path = url.pathname;

		// Serve static assets
		if (path === '/' || path === '/upload') {
			const page = path === '/' ? 'index.html' : 'upload.html';
			return env.ASSETS.fetch(new Request(new URL(page, request.url)));
		}

		// API endpoints
		if (path === '/api/upload') {
			return handleUpload(request, env);
		}

		// Check if path matches the pattern of two words with optional extension
		const filePathRegex = /^\/([a-z]+)-([a-z]+)(?:\.[a-z0-9]+)?$/;
		if (filePathRegex.test(path)) {
			return handleFileRetrieval(path, env);
		}

		// Default response for undefined routes
		return new Response('Not Found', { status: 404 });
	},
} satisfies ExportedHandler<Env>;

/**
 * Generate a readable file key using two random words
 */
function generateReadableKey(fileName: string): string {
	// Get two random words
	const word1 = WORDS[Math.floor(Math.random() * WORDS.length)];
	const word2 = WORDS[Math.floor(Math.random() * WORDS.length)];
	
	// Combine with extension for metadata
	const extension = fileName.includes('.') ? fileName.split('.').pop() : '';
	
	// Return hyphenated words with an extension identifier if available
	return `${word1}-${word2}${extension ? '.' + extension : ''}`;
}

/**
 * Determine if a file type should be rendered in browser
 */
function isRenderableType(contentType: string): boolean {
	return RENDERABLE_TYPES.includes(contentType);
}

/**
 * Handle file upload from multipart form data
 */
async function handleUpload(request: Request, env: Env): Promise<Response> {
	// Only allow POST method
	if (request.method !== 'POST') {
		return new Response('Method Not Allowed', { status: 405 });
	}

	try {
		// Parse the FormData from the request
		const formData = await request.formData();
		const file = formData.get('file') as File;
		
		if (!file) {
			return new Response('No file provided', { status: 400 });
		}

		// Generate a unique readable key for the file
		const uniqueKey = generateReadableKey(file.name);
		
		// Determine if this file type should be displayed inline
		const disposition = isRenderableType(file.type) 
			? `inline; filename="${file.name}"`
			: `attachment; filename="${file.name}"`;
		
		// Upload the file to R2
		const arrayBuffer = await file.arrayBuffer();
		await env.FILES_BUCKET.put(uniqueKey, arrayBuffer, {
			httpMetadata: {
				contentType: file.type,
				contentDisposition: disposition,
			},
			customMetadata: {
				originalName: file.name
			}
		});

		// Return the URL for accessing the file
		const fileUrl = `${new URL(request.url).origin}/${uniqueKey}`;
		
		return new Response(JSON.stringify({
			success: true,
			url: fileUrl,
		}), {
			headers: {
				'Content-Type': 'application/json',
			},
		});
	} catch (error) {
		// Log the error and return a generic error message
		console.error('Upload error:', error);
		return new Response(JSON.stringify({
			success: false,
			error: 'Failed to process upload',
		}), {
			status: 500,
			headers: {
				'Content-Type': 'application/json',
			},
		});
	}
}

/**
 * Handle file retrieval from R2
 */
async function handleFileRetrieval(path: string, env: Env): Promise<Response> {
	// Extract the key - remove the leading slash
	const key = path.startsWith('/') ? path.slice(1) : path;
	
	// Get the file from R2
	const object = await env.FILES_BUCKET.get(key);
	
	if (!object) {
		return new Response('File Not Found', { status: 404 });
	}
	
	// Return the file with appropriate headers
	const headers = new Headers();
	
	// Set content type and disposition from object metadata
	object.writeHttpMetadata(headers);
	headers.set('etag', object.httpEtag);
	
	// Return the file
	return new Response(object.body, {
		headers,
	});
}