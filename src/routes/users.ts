import { Router, Request, Response } from 'express';
import {
  createUser,
  getUserById,
  getAllUsers,
  getActiveUsers,
  updateUser,
  deleteUser,
  updateUserGmailToken,
  createEmailTemplate,
  getEmailTemplatesByUserId,
  deleteEmailTemplatesByUserId,
} from '../db/repositories';
import { getAuthUrlForUser, getTokensFromCode, clearUserGmailCache } from '../services/gmail';
import {
  getDefaultConfirmationRequestTemplate,
  getDefaultFinalReminderTemplate,
  getDefaultAcknowledgementTemplate,
  getDefaultCancellationTemplate,
} from '../services/email';
import { TEMPLATE_TYPES, TemplateType } from '../types';

const router = Router();

// Get all users
router.get('/users', async (req: Request, res: Response) => {
  try {
    const { active } = req.query;
    const users = active === 'true' ? await getActiveUsers() : await getAllUsers();

    return res.json({
      users: users.map((u) => ({
        id: u.id,
        name: u.name,
        email: u.email,
        isActive: u.isActive,
        hasGmailConnected: !!u.gmailRefreshToken,
        createdAt: u.createdAt.toISOString(),
      })),
    });
  } catch (error) {
    console.error('Error fetching users:', error);
    return res.status(500).json({ error: 'Failed to fetch users' });
  }
});

// Get a specific user
router.get('/users/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const user = await getUserById(id);

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    return res.json({
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        isActive: user.isActive,
        hasGmailConnected: !!user.gmailRefreshToken,
        createdAt: user.createdAt.toISOString(),
      },
    });
  } catch (error) {
    console.error('Error fetching user:', error);
    return res.status(500).json({ error: 'Failed to fetch user' });
  }
});

// Create a new user
router.post('/users', async (req: Request, res: Response) => {
  try {
    const { name, email } = req.body;

    if (!name || !email) {
      return res.status(400).json({
        error: 'Missing required fields',
        required: ['name', 'email'],
      });
    }

    // Validate email format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return res.status(400).json({ error: 'Invalid email format' });
    }

    const user = await createUser({ name, email });

    // Create default templates for the user
    await seedDefaultTemplatesForUser(user.id, user.name);

    console.log(`Created user: ${user.name} (${user.email})`);

    return res.status(201).json({
      success: true,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        isActive: user.isActive,
        hasGmailConnected: false,
        createdAt: user.createdAt.toISOString(),
      },
    });
  } catch (error: any) {
    if (error.message?.includes('UNIQUE constraint failed') || error.message?.includes('duplicate key')) {
      return res.status(400).json({ error: 'A user with this email already exists' });
    }
    console.error('Error creating user:', error);
    return res.status(500).json({ error: 'Failed to create user' });
  }
});

// Update a user
router.put('/users/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { name, email, isActive } = req.body;

    const user = await getUserById(id);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    const updated = await updateUser(id, { name, email, isActive });

    return res.json({
      success: true,
      user: {
        id: updated!.id,
        name: updated!.name,
        email: updated!.email,
        isActive: updated!.isActive,
        hasGmailConnected: !!updated!.gmailRefreshToken,
        createdAt: updated!.createdAt.toISOString(),
      },
    });
  } catch (error) {
    console.error('Error updating user:', error);
    return res.status(500).json({ error: 'Failed to update user' });
  }
});

// Delete a user
router.delete('/users/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    const user = await getUserById(id);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Delete user's templates first
    await deleteEmailTemplatesByUserId(id);

    // Clear Gmail cache
    clearUserGmailCache(id);

    // Delete the user
    await deleteUser(id);

    console.log(`Deleted user: ${user.name} (${user.email})`);

    return res.json({ success: true });
  } catch (error) {
    console.error('Error deleting user:', error);
    return res.status(500).json({ error: 'Failed to delete user' });
  }
});

// Get Gmail auth URL for a user
router.get('/users/:id/auth-url', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    const user = await getUserById(id);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    const authUrl = getAuthUrlForUser(id);

    return res.json({ authUrl });
  } catch (error) {
    console.error('Error generating auth URL:', error);
    return res.status(500).json({ error: 'Failed to generate auth URL' });
  }
});

// Handle OAuth callback for a user
router.get('/users/auth/callback', async (req: Request, res: Response) => {
  try {
    const { code, state: userId } = req.query;

    if (!code || !userId) {
      return res.status(400).json({ error: 'Missing code or state parameter' });
    }

    const user = await getUserById(userId as string);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Exchange code for tokens
    const tokens = await getTokensFromCode(code as string);

    // Save refresh token
    await updateUserGmailToken(userId as string, tokens.refresh_token);

    // Clear cached clients
    clearUserGmailCache(userId as string);

    console.log(`Gmail connected for user: ${user.name} (${user.email})`);

    // Redirect to settings page with success message
    return res.redirect('/settings.html?gmail=connected&user=' + encodeURIComponent(user.name));
  } catch (error) {
    console.error('Error handling OAuth callback:', error);
    return res.redirect('/settings.html?gmail=error');
  }
});

// Disconnect Gmail for a user
router.post('/users/:id/disconnect-gmail', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    const user = await getUserById(id);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Clear the refresh token
    await updateUserGmailToken(id, '');

    // Clear cached clients
    clearUserGmailCache(id);

    console.log(`Gmail disconnected for user: ${user.name}`);

    return res.json({ success: true });
  } catch (error) {
    console.error('Error disconnecting Gmail:', error);
    return res.status(500).json({ error: 'Failed to disconnect Gmail' });
  }
});

// Helper function to seed default templates for a new user
async function seedDefaultTemplatesForUser(userId: string, userName: string): Promise<void> {
  const templateConfigs: { type: TemplateType; getDefault: (name: string) => { subject: string; htmlBody: string; textBody: string } }[] = [
    { type: 'confirmation_request', getDefault: getDefaultConfirmationRequestTemplate },
    { type: 'final_reminder', getDefault: getDefaultFinalReminderTemplate },
    { type: 'acknowledgement', getDefault: getDefaultAcknowledgementTemplate },
    { type: 'cancellation', getDefault: getDefaultCancellationTemplate },
  ];

  for (const config of templateConfigs) {
    const template = config.getDefault(userName);
    try {
      await createEmailTemplate({
        userId,
        templateType: config.type,
        subject: template.subject,
        htmlBody: template.htmlBody,
        textBody: template.textBody,
      });
    } catch (e) {
      // Template might already exist, ignore
    }
  }
}

export default router;
