import dotenv from 'dotenv';
import { hasRealEnvValue } from '../config/env.js';

dotenv.config();

/**
 * EMQX Cloud Serverless Deployment API Client
 * Uses Basic Auth (AppID + AppSecret) to manage built-in database users.
 */
class EmqxAdmin {
  constructor() {
    this.baseUrl = process.env.EMQX_API_URL;
    this.appId = process.env.EMQX_APP_ID;
    this.appSecret = process.env.EMQX_APP_SECRET;
    this.authId = process.env.EMQX_AUTH_ID || 'password_based%3Abuilt_in_database';

    if (!this.isConfigured()) {
      console.warn('EMQX Admin credentials are not configured.');
    }
  }

  isConfigured() {
    return hasRealEnvValue('EMQX_API_URL') && hasRealEnvValue('EMQX_APP_ID') && hasRealEnvValue('EMQX_APP_SECRET');
  }

  get headers() {
    const auth = Buffer.from(`${this.appId}:${this.appSecret}`).toString('base64');
    return {
      'Content-Type': 'application/json',
      'Authorization': `Basic ${auth}`
    };
  }

  /**
   * Create a new user in the built-in database
   * POST /api/v5/authentication/{id}/users
   */
  async createUser(userId, password) {
    if (!this.isConfigured()) return false;

    try {
      const response = await fetch(`${this.baseUrl}/api/v5/authentication/${this.authId}/users`, {
        method: 'POST',
        headers: this.headers,
        body: JSON.stringify({ user_id: userId, password })
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error(`EMQX Create User Error (${response.status}):`, errorText);
        // 400 Bad Request usually means user already exists
        if (response.status === 400 && errorText.includes('already_exists')) {
             return true; 
        }
        throw new Error(`Failed to create EMQX user: ${response.statusText}`);
      }
      return true;
    } catch (error) {
      console.error('EMQX createUser exception:', error);
      throw error;
    }
  }

  /**
   * Delete a user from the built-in database
   * DELETE /api/v5/authentication/{id}/users/{user_id}
   */
  async deleteUser(userId) {
    if (!this.isConfigured()) return false;

    try {
      const response = await fetch(`${this.baseUrl}/api/v5/authentication/${this.authId}/users/${encodeURIComponent(userId)}`, {
        method: 'DELETE',
        headers: this.headers
      });

      if (!response.ok && response.status !== 404) {
        const errorText = await response.text();
        console.error(`EMQX Delete User Error (${response.status}):`, errorText);
        throw new Error(`Failed to delete EMQX user: ${response.statusText}`);
      }
      return true;
    } catch (error) {
      console.error('EMQX deleteUser exception:', error);
      throw error;
    }
  }

  /**
   * List users (for debugging/admin)
   * GET /api/v5/authentication/{id}/users
   */
  async listUsers(page = 1, limit = 100) {
    if (!this.isConfigured()) return { data: [], meta: {} };

    try {
      const response = await fetch(`${this.baseUrl}/api/v5/authentication/${this.authId}/users?page=${page}&limit=${limit}`, {
        method: 'GET',
        headers: this.headers
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error(`EMQX List Users Error (${response.status}):`, errorText);
        throw new Error(`Failed to list EMQX users: ${response.statusText}`);
      }
      return await response.json();
    } catch (error) {
      console.error('EMQX listUsers exception:', error);
      throw error;
    }
  }
}

export const emqxAdmin = new EmqxAdmin();
