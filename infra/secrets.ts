// All of our secret environment variables
export const DATABASE_URL = new sst.Secret('DATABASE_URL');
export const DIRECT_DATABASE_URL = new sst.Secret('DIRECT_DATABASE_URL');

// Better Auth
export const BETTER_AUTH_SECRET = new sst.Secret('BETTER_AUTH_SECRET');

// AI
export const OPENAI_API_KEY = new sst.Secret('OPENAI_API_KEY');

// Set the default secrets for the stage...
export const STAGE = new sst.Secret('STAGE', $app.stage);
