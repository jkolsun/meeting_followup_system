import { Router, Request, Response } from 'express';
import {
  getUserById,
  getEmailTemplate,
  getEmailTemplateById,
  getEmailTemplatesByUserId,
  updateEmailTemplate,
  createEmailTemplate,
} from '../db/repositories';
import {
  getDefaultConfirmationRequestTemplate,
  getDefaultFinalReminderTemplate,
  getDefaultAcknowledgementTemplate,
  getDefaultCancellationTemplate,
} from '../services/email';
import { TemplateType, TEMPLATE_TYPES } from '../types';

const router = Router();

// Get all templates for a user
router.get('/templates', async (req: Request, res: Response) => {
  try {
    const { userId } = req.query;

    if (!userId) {
      return res.status(400).json({ error: 'userId query parameter is required' });
    }

    const user = await getUserById(userId as string);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    const templates = await getEmailTemplatesByUserId(userId as string);

    return res.json({
      templates: templates.map((t) => ({
        id: t.id,
        userId: t.userId,
        templateType: t.templateType,
        subject: t.subject,
        htmlBody: t.htmlBody,
        textBody: t.textBody,
        updatedAt: t.updatedAt.toISOString(),
      })),
    });
  } catch (error) {
    console.error('Error fetching templates:', error);
    return res.status(500).json({ error: 'Failed to fetch templates' });
  }
});

// Get a specific template
router.get('/templates/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const template = await getEmailTemplateById(id);

    if (!template) {
      return res.status(404).json({ error: 'Template not found' });
    }

    return res.json({
      template: {
        id: template.id,
        userId: template.userId,
        templateType: template.templateType,
        subject: template.subject,
        htmlBody: template.htmlBody,
        textBody: template.textBody,
        updatedAt: template.updatedAt.toISOString(),
      },
    });
  } catch (error) {
    console.error('Error fetching template:', error);
    return res.status(500).json({ error: 'Failed to fetch template' });
  }
});

// Update a template
router.put('/templates/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { subject, htmlBody, textBody } = req.body;

    const template = await getEmailTemplateById(id);
    if (!template) {
      return res.status(404).json({ error: 'Template not found' });
    }

    const updated = await updateEmailTemplate(id, { subject, htmlBody, textBody });

    console.log(`Updated template ${template.templateType} for user ${template.userId}`);

    return res.json({
      success: true,
      template: {
        id: updated!.id,
        userId: updated!.userId,
        templateType: updated!.templateType,
        subject: updated!.subject,
        htmlBody: updated!.htmlBody,
        textBody: updated!.textBody,
        updatedAt: updated!.updatedAt.toISOString(),
      },
    });
  } catch (error) {
    console.error('Error updating template:', error);
    return res.status(500).json({ error: 'Failed to update template' });
  }
});

// Reset a template to default
router.post('/templates/reset/:userId/:templateType', async (req: Request, res: Response) => {
  try {
    const { userId, templateType } = req.params;

    const user = await getUserById(userId);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    if (!TEMPLATE_TYPES.includes(templateType as TemplateType)) {
      return res.status(400).json({ error: 'Invalid template type' });
    }

    // Get default template
    const defaultTemplate = getDefaultTemplate(templateType as TemplateType, user.name);

    // Find existing template
    const existing = await getEmailTemplate(userId, templateType as TemplateType);

    if (existing) {
      // Update existing
      const updated = await updateEmailTemplate(existing.id, {
        subject: defaultTemplate.subject,
        htmlBody: defaultTemplate.htmlBody,
        textBody: defaultTemplate.textBody,
      });

      return res.json({
        success: true,
        template: {
          id: updated!.id,
          userId: updated!.userId,
          templateType: updated!.templateType,
          subject: updated!.subject,
          htmlBody: updated!.htmlBody,
          textBody: updated!.textBody,
          updatedAt: updated!.updatedAt.toISOString(),
        },
      });
    } else {
      // Create new
      const created = await createEmailTemplate({
        userId,
        templateType: templateType as TemplateType,
        subject: defaultTemplate.subject,
        htmlBody: defaultTemplate.htmlBody,
        textBody: defaultTemplate.textBody,
      });

      return res.json({
        success: true,
        template: {
          id: created.id,
          userId: created.userId,
          templateType: created.templateType,
          subject: created.subject,
          htmlBody: created.htmlBody,
          textBody: created.textBody,
          updatedAt: created.updatedAt.toISOString(),
        },
      });
    }
  } catch (error) {
    console.error('Error resetting template:', error);
    return res.status(500).json({ error: 'Failed to reset template' });
  }
});

// Get default template content (for preview)
router.get('/templates/default/:templateType', async (req: Request, res: Response) => {
  try {
    const { templateType } = req.params;
    const { senderName } = req.query;

    if (!TEMPLATE_TYPES.includes(templateType as TemplateType)) {
      return res.status(400).json({ error: 'Invalid template type' });
    }

    const template = getDefaultTemplate(templateType as TemplateType, (senderName as string) || 'The Team');

    return res.json({ template });
  } catch (error) {
    console.error('Error fetching default template:', error);
    return res.status(500).json({ error: 'Failed to fetch default template' });
  }
});

function getDefaultTemplate(
  templateType: TemplateType,
  senderName: string
): { subject: string; htmlBody: string; textBody: string } {
  switch (templateType) {
    case 'confirmation_request':
      return getDefaultConfirmationRequestTemplate(senderName);
    case 'final_reminder':
      return getDefaultFinalReminderTemplate(senderName);
    case 'acknowledgement':
      return getDefaultAcknowledgementTemplate(senderName);
    case 'cancellation':
      return getDefaultCancellationTemplate(senderName);
    default:
      return getDefaultConfirmationRequestTemplate(senderName);
  }
}

export default router;
