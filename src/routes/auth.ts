import { Router, Request, Response, NextFunction } from 'express';
import { supabase, supabaseAdmin, isAuthEnabled } from '../config/supabase';
import {
  createOrganization,
  getOrganizationByOwnerAuthId,
  getOrganizationBySlug,
  getUserByAuthId,
  createUser,
  getUsersByOrganizationId,
} from '../db/repositories';

const router = Router();

// Middleware to extract and verify auth token
export async function authMiddleware(req: Request, res: Response, next: NextFunction) {
  if (!isAuthEnabled()) {
    // Auth disabled - allow through for demo mode
    return next();
  }

  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Missing authorization header' });
  }

  const token = authHeader.substring(7);

  try {
    const { data: { user }, error } = await supabase!.auth.getUser(token);

    if (error || !user) {
      return res.status(401).json({ error: 'Invalid or expired token' });
    }

    // Attach user to request
    (req as any).authUser = user;

    // Get organization for this user
    const org = await getOrganizationByOwnerAuthId(user.id);
    if (org) {
      (req as any).organization = org;
    }

    next();
  } catch (error) {
    console.error('Auth middleware error:', error);
    return res.status(401).json({ error: 'Authentication failed' });
  }
}

// Optional auth - doesn't require auth but attaches user if present
export async function optionalAuthMiddleware(req: Request, res: Response, next: NextFunction) {
  if (!isAuthEnabled()) {
    return next();
  }

  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) {
    return next();
  }

  const token = authHeader.substring(7);

  try {
    const { data: { user } } = await supabase!.auth.getUser(token);
    if (user) {
      (req as any).authUser = user;
      const org = await getOrganizationByOwnerAuthId(user.id);
      if (org) {
        (req as any).organization = org;
      }
    }
  } catch (error) {
    // Ignore auth errors for optional auth
  }

  next();
}

// Get Supabase config for client
router.get('/auth/config', (req: Request, res: Response) => {
  res.json({
    supabaseUrl: process.env.SUPABASE_URL || null,
    supabaseAnonKey: process.env.SUPABASE_ANON_KEY || null,
  });
});

// Check if user has an organization
router.get('/auth/check-org', authMiddleware, async (req: Request, res: Response) => {
  const authUser = (req as any).authUser;

  try {
    const org = await getOrganizationByOwnerAuthId(authUser.id);
    res.json({ hasOrganization: !!org, organization: org });
  } catch (error) {
    console.error('Error checking org:', error);
    res.status(500).json({ error: 'Failed to check organization' });
  }
});

// Handle OAuth callback
router.get('/auth/callback', async (req: Request, res: Response) => {
  // Supabase handles the OAuth callback automatically
  // This endpoint just redirects to appropriate page
  res.redirect('/');
});

// Create organization
router.post('/organizations', authMiddleware, async (req: Request, res: Response) => {
  const authUser = (req as any).authUser;
  const { name, slug, userName } = req.body;

  if (!name || !slug) {
    return res.status(400).json({ error: 'Name and slug are required' });
  }

  // Validate slug format
  if (!/^[a-z0-9-]+$/.test(slug)) {
    return res.status(400).json({ error: 'Slug can only contain lowercase letters, numbers, and hyphens' });
  }

  try {
    // Check if slug is taken
    const existing = await getOrganizationBySlug(slug);
    if (existing) {
      return res.status(400).json({ error: 'This workspace URL is already taken' });
    }

    // Check if user already has an org
    const existingOrg = await getOrganizationByOwnerAuthId(authUser.id);
    if (existingOrg) {
      return res.status(400).json({ error: 'You already have an organization' });
    }

    // Create organization
    const org = await createOrganization({
      name,
      slug,
      ownerAuthId: authUser.id,
    });

    // Create user record for the owner
    const user = await createUser({
      name: userName || authUser.email?.split('@')[0] || 'Owner',
      email: authUser.email!,
      organizationId: org.id,
      authId: authUser.id,
      role: 'owner',
    });

    res.json({ organization: org, user });
  } catch (error) {
    console.error('Error creating organization:', error);
    res.status(500).json({ error: 'Failed to create organization' });
  }
});

// Get current organization
router.get('/organizations/me', authMiddleware, async (req: Request, res: Response) => {
  const org = (req as any).organization;

  if (!org) {
    return res.status(404).json({ error: 'No organization found' });
  }

  res.json({ organization: org });
});

// Get Google Calendar auth URL for organization
router.get('/organizations/me/calendar-auth-url', authMiddleware, async (req: Request, res: Response) => {
  const org = (req as any).organization;

  if (!org) {
    return res.status(404).json({ error: 'No organization found' });
  }

  // Use the same Google OAuth but with calendar scopes
  const { google } = require('googleapis');
  const oauth2Client = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    `${process.env.BASE_URL}/api/organizations/calendar-callback`
  );

  const authUrl = oauth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: [
      'https://www.googleapis.com/auth/calendar.readonly',
      'https://www.googleapis.com/auth/calendar.events.readonly',
    ],
    state: org.id,
    prompt: 'consent',
  });

  res.json({ authUrl });
});

// Handle Google Calendar OAuth callback
router.get('/organizations/calendar-callback', async (req: Request, res: Response) => {
  const { code, state: orgId } = req.query;

  if (!code || !orgId) {
    return res.redirect('/onboarding.html?error=missing_params');
  }

  try {
    const { google } = require('googleapis');
    const oauth2Client = new google.auth.OAuth2(
      process.env.GOOGLE_CLIENT_ID,
      process.env.GOOGLE_CLIENT_SECRET,
      `${process.env.BASE_URL}/api/organizations/calendar-callback`
    );

    const { tokens } = await oauth2Client.getToken(code as string);
    const { updateOrganization } = require('../db/repositories');

    await updateOrganization(orgId as string, {
      googleCalendarConnected: true,
      googleCalendarRefreshToken: tokens.refresh_token,
    });

    res.redirect('/onboarding.html?calendar=connected');
  } catch (error) {
    console.error('Calendar OAuth error:', error);
    res.redirect('/onboarding.html?error=calendar_failed');
  }
});

// Get current user
router.get('/users/me', authMiddleware, async (req: Request, res: Response) => {
  const authUser = (req as any).authUser;

  try {
    const user = await getUserByAuthId(authUser.id);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }
    res.json({ user });
  } catch (error) {
    console.error('Error getting user:', error);
    res.status(500).json({ error: 'Failed to get user' });
  }
});

// Get Gmail auth URL for current user
router.get('/users/me/auth-url', authMiddleware, async (req: Request, res: Response) => {
  const authUser = (req as any).authUser;
  const org = (req as any).organization;

  if (!org) {
    return res.status(404).json({ error: 'No organization found' });
  }

  try {
    const user = await getUserByAuthId(authUser.id);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    const { google } = require('googleapis');
    const oauth2Client = new google.auth.OAuth2(
      process.env.GOOGLE_CLIENT_ID,
      process.env.GOOGLE_CLIENT_SECRET,
      `${process.env.BASE_URL}/api/users/gmail-callback`
    );

    const authUrl = oauth2Client.generateAuthUrl({
      access_type: 'offline',
      scope: [
        'https://www.googleapis.com/auth/gmail.send',
        'https://www.googleapis.com/auth/gmail.readonly',
      ],
      state: user.id,
      prompt: 'consent',
    });

    res.json({ authUrl });
  } catch (error) {
    console.error('Error getting auth URL:', error);
    res.status(500).json({ error: 'Failed to get auth URL' });
  }
});

// Handle Gmail OAuth callback for authenticated users
router.get('/users/gmail-callback', async (req: Request, res: Response) => {
  const { code, state: userId } = req.query;

  if (!code || !userId) {
    return res.redirect('/onboarding.html?error=missing_params');
  }

  try {
    const { google } = require('googleapis');
    const oauth2Client = new google.auth.OAuth2(
      process.env.GOOGLE_CLIENT_ID,
      process.env.GOOGLE_CLIENT_SECRET,
      `${process.env.BASE_URL}/api/users/gmail-callback`
    );

    const { tokens } = await oauth2Client.getToken(code as string);
    const { updateUserGmailToken, getUserById } = require('../db/repositories');

    await updateUserGmailToken(userId as string, tokens.refresh_token);
    const user = await getUserById(userId as string);

    res.redirect(`/onboarding.html?gmail=connected&user=${encodeURIComponent(user?.name || '')}`);
  } catch (error) {
    console.error('Gmail OAuth error:', error);
    res.redirect('/onboarding.html?error=gmail_failed');
  }
});

export default router;
