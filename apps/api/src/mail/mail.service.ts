import { Injectable } from '@nestjs/common';
import nodemailer, { type Transporter } from 'nodemailer';
import { config } from '../config';

export interface MailMessage {
  to: string;
  subject: string;
  text: string;
  html?: string;
}

/** Odesílání e-mailů přes SMTP (v dev Mailpit z docker-compose, UI na http://localhost:8025). */
@Injectable()
export class MailService {
  private transporter: Transporter | null = null;

  async send(message: MailMessage): Promise<void> {
    this.transporter ??= nodemailer.createTransport({
      host: config.smtp.host,
      port: config.smtp.port,
      secure: false,
    });
    await this.transporter.sendMail({ from: config.smtp.from, ...message });
  }
}
