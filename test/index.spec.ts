import { env, createExecutionContext, waitOnExecutionContext, SELF } from 'cloudflare:test';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import worker from '../src';

describe('Share Stuff Worker', () => {
	// Mock R2 bucket
	const mockBucket = {
		put: vi.fn().mockResolvedValue({}),
		get: vi.fn().mockImplementation((key) => {
			if (key === 'test-file-key') {
				return {
					body: new Blob(['test file content'], { type: 'text/plain' }),
					httpEtag: '"test-etag"',
					writeHttpMetadata: (headers) => {
						headers.set('content-type', 'text/plain');
						headers.set('content-disposition', 'attachment; filename="test-file.txt"');
					}
				};
			}
			return null;
		})
	};

	// Mock environment with R2 bucket
	const mockEnv = {
		...env,
		FILES_BUCKET: mockBucket,
		ASSETS: {
			fetch: vi.fn().mockImplementation((request) => {
				const url = new URL(request.url);
				if (url.pathname === '/index.html') {
					return new Response('<html>Index page</html>', {
						headers: { 'Content-Type': 'text/html' }
					});
				}
				if (url.pathname === '/upload.html') {
					return new Response('<html>Upload page</html>', {
						headers: { 'Content-Type': 'text/html' }
					});
				}
				return new Response('Not found', { status: 404 });
			})
		}
	};

	beforeEach(() => {
		vi.clearAllMocks();
	});

	describe('Static assets', () => {
		it('/ serves the index page', async () => {
			const request = new Request('http://example.com/');
			const ctx = createExecutionContext();
			const response = await worker.fetch(request, mockEnv, ctx);
			await waitOnExecutionContext(ctx);
			
			expect(mockEnv.ASSETS.fetch).toHaveBeenCalled();
			expect(await response.text()).toContain('Index page');
		});

		it('/upload serves the upload page', async () => {
			const request = new Request('http://example.com/upload');
			const ctx = createExecutionContext();
			const response = await worker.fetch(request, mockEnv, ctx);
			await waitOnExecutionContext(ctx);
			
			expect(mockEnv.ASSETS.fetch).toHaveBeenCalled();
			expect(await response.text()).toContain('Upload page');
		});
	});

	describe('File upload endpoint', () => {
		it('/api/upload handles file uploads', async () => {
			// Create a FormData with a file
			const formData = new FormData();
			const fileContent = 'test file content';
			const file = new File([fileContent], 'test-file.txt', { type: 'text/plain' });
			formData.append('file', file);

			// Create the request
			const request = new Request('http://example.com/api/upload', {
				method: 'POST',
				body: formData
			});

			// Call the endpoint
			const ctx = createExecutionContext();
			const response = await worker.fetch(request, mockEnv, ctx);
			await waitOnExecutionContext(ctx);
			
			// Check response
			expect(response.status).toBe(200);
			const responseBody = await response.json();
			expect(responseBody.success).toBe(true);
			expect(responseBody.url).toContain('/easy-share/');
			
			// Verify R2 bucket was called
			expect(mockBucket.put).toHaveBeenCalled();
		});

		it('/api/upload returns 405 for non-POST requests', async () => {
			const request = new Request('http://example.com/api/upload', {
				method: 'GET'
			});
			
			const ctx = createExecutionContext();
			const response = await worker.fetch(request, mockEnv, ctx);
			await waitOnExecutionContext(ctx);
			
			expect(response.status).toBe(405);
		});
	});

	describe('File retrieval endpoint', () => {
		it('/easy-share/{key} retrieves files from R2', async () => {
			const request = new Request('http://example.com/easy-share/test-file-key');
			
			const ctx = createExecutionContext();
			const response = await worker.fetch(request, mockEnv, ctx);
			await waitOnExecutionContext(ctx);
			
			expect(response.status).toBe(200);
			expect(await response.text()).toBe('test file content');
			expect(response.headers.get('content-type')).toBe('text/plain');
			expect(response.headers.get('content-disposition')).toContain('attachment');
			expect(response.headers.get('etag')).toBe('"test-etag"');
			
			expect(mockBucket.get).toHaveBeenCalledWith('test-file-key');
		});

		it('/easy-share/{key} returns 404 for non-existent files', async () => {
			const request = new Request('http://example.com/easy-share/non-existent-key');
			
			const ctx = createExecutionContext();
			const response = await worker.fetch(request, mockEnv, ctx);
			await waitOnExecutionContext(ctx);
			
			expect(response.status).toBe(404);
			expect(mockBucket.get).toHaveBeenCalledWith('non-existent-key');
		});
	});
});