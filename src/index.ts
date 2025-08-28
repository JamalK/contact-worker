/**
 * Welcome to Cloudflare Workers! This is your first worker.
 *
 * - Run `npm run dev` in your terminal to start a development server
 * - Open a browser tab at http://localhost:8787/ to see your worker in action
 * - Run `npm run deploy` to publish your worker
 *
 * Bind resources to your worker in `wrangler.jsonc`. After adding bindings, a type definition for the
 * `Env` object can be regenerated with `npm run cf-typegen`.
 *
 * Learn more at https://developers.cloudflare.com/workers/
 */

export interface ContactPayload {
	name: string;
	email: string;
	message: string;
	token: string; // Turnstile token from frontend
}

import { env } from 'cloudflare:workers';
import { WorkerMailer } from 'worker-mailer';

export default {
	async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
		if (request.method === 'OPTIONS') {
			const allowedOrigin = 'https://beroea.tech';

			return new Response(null, {
				headers: {
					'Access-Control-Allow-Origin': allowedOrigin,
					'Access-Control-Allow-Methods': 'POST, OPTIONS',
					'Access-Control-Allow-Headers': 'Content-Type',
				},
			});
		}

		if (request.method === 'POST') {
			try {
				const data = await request.json<{
					name?: string;
					email?: string;
					message?: string;
					token?: string;
				}>();

				// Content validation
				if (!data.name || !data.email || !data.message) {
					return jsonResponse({ error: 'Missing required fields' }, 400);
				}

				if (
					typeof data.name !== 'string' ||
					typeof data.email !== 'string' ||
					typeof data.message !== 'string' ||
					typeof data.token !== 'string'
				) {
					return jsonResponse({ error: 'Invalid field types' }, 400);
				}

				// 2️⃣ Validate content
				if (data.name.length > 100 || data.message.length > 1000) {
					return jsonResponse({ error: 'Input too long' }, 400);
				}

				const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
				if (!emailRegex.test(data.email)) {
					return jsonResponse({ error: 'Invalid email format' }, 400);
				}

				const turnstileRes = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
					method: 'POST',
					body: new URLSearchParams({
						secret: env.TURNSTILE_SECRET,
						response: data.token,
					}),
				});

				const outcome = await turnstileRes.json<{ success: boolean }>();
				if (!outcome.success) {
					return jsonResponse({ error: 'Turnstile verification failed' }, 403);
				}

				// Craft the email
				const mailer = await WorkerMailer.connect({
					credentials: {
						username: 'feedback@beroea.tech',
						password: env.pass,
					},
					authType: 'plain',
					host: 'smtp.migadu.com',
					port: 465,
					secure: true,
				});

				await mailer.send({
					from: { name: 'Feedback', email: 'feedback@beroea.tech' },
					to: { name: 'Jamal', email: 'jamal@beroea.tech' },
					subject: `Feedback from ${data['name']}`,
					text: `Message: ${data['message']} \n\n ${data['email']}`,
					html: `<p>Feedback content:</p> <p>${data['message']}</p> <p>Sender: ${data['email']}</p>`,
				});

				mailer.close();

				return new Response(JSON.stringify({ success: true, received: data }), {
					status: 200,
					headers: {
						'Content-Type': 'application/json',
						'Access-Control-Allow-Origin': '*', // allow frontend calls
					},
				});
			} catch (err) {
				return new Response(JSON.stringify({ error: `Bad Request` }), {
					status: 400,
					headers: { 'Content-Type': 'application/json' },
				});
			}
		}

		return new Response('Method Not Allowed', { status: 405 });
	},
};

// Utility: JSON responses
function jsonResponse(body: unknown, status = 200): Response {
	return new Response(JSON.stringify(body), {
		status,
		headers: { 'Content-Type': 'application/json' },
	});
}

export interface Env {
	TURNSTILE_SECRET: string;
	pass: string;
}
