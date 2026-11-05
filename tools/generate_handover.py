# -*- coding: utf-8 -*-
"""
Full Handover Generator for MITTAI BANDI
Builds PDF and DOCX documents with comprehensive, audited technical details.
Prepared with gratitude by ARANEA DEN for GURMITRAA Technologies Pvt. Ltd.
"""

import os
import sys
from datetime import datetime
from reportlab.lib.pagesizes import letter
from reportlab.lib import colors
from reportlab.lib.units import inch
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.platypus import (
    SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle, PageBreak, KeepTogether, HRFlowable
)
from reportlab.pdfgen import canvas

import docx
from docx import Document
from docx.shared import Inches, Pt, RGBColor
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.enum.table import WD_TABLE_ALIGNMENT
from docx.oxml import OxmlElement, parse_xml
from docx.oxml.ns import nsdecls, qn

PDF_OUTPUT = "MITTAI_BANDI_Technical_Documentation_and_Client_Handover.pdf"
DOCX_OUTPUT = "MITTAI_BANDI_Technical_Documentation_and_Client_Handover.docx"

PRIMARY = colors.HexColor("#C9003D")
PRIMARY_DARK = colors.HexColor("#8B0028")
SECONDARY = colors.HexColor("#C99D3D")
DARK_TEXT = colors.HexColor("#1A1A1A")
MUTED_TEXT = colors.HexColor("#4B5563")
LIGHT_BG = colors.HexColor("#FFFDF9")
ACCENT_BG = colors.HexColor("#F8F9FA")
BORDER_COLOR = colors.HexColor("#E5E7EB")
CALLOUT_BG = colors.HexColor("#FEF2F2")
CALLOUT_BORDER = colors.HexColor("#FECACA")
CODE_BG = colors.HexColor("#F3F4F6")

class NumberedCanvas(canvas.Canvas):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self._saved_page_states = []

    def showPage(self):
        self._saved_page_states.append(dict(self.__dict__))
        self._startPage()

    def save(self):
        num_pages = len(self._saved_page_states)
        for state in self._saved_page_states:
            self.__dict__.update(state)
            self.draw_page_decorations(num_pages)
            super().showPage()
        super().save()

    def draw_page_decorations(self, total_pages):
        if self._pageNumber == 1:
            return

        self.saveState()
        self.setFont("Helvetica-Bold", 8)
        self.setFillColor(colors.HexColor("#6B7280"))

        # Running Header
        self.drawString(54, 11 * inch - 36, "MITTAI BANDI — Technical Documentation & Client Handover")
        self.setFont("Helvetica", 8)
        self.drawRightString(8.5 * inch - 54, 11 * inch - 36, "Crafted by ARANEA DEN")
        self.setStrokeColor(colors.HexColor("#E5E7EB"))
        self.setLineWidth(0.6)
        self.line(54, 11 * inch - 42, 8.5 * inch - 54, 11 * inch - 42)

        # Running Footer
        self.line(54, 46, 8.5 * inch - 54, 46)
        self.drawString(54, 32, "Confidential — Gurmitraa Technologies Pvt. Ltd. | www.mittaibandi.com")
        page_str = f"Page {self._pageNumber} of {total_pages}"
        self.drawRightString(8.5 * inch - 54, 32, page_str)

        self.restoreState()


def build_pdf():
    doc = SimpleDocTemplate(
        PDF_OUTPUT,
        pagesize=letter,
        leftMargin=54,
        rightMargin=54,
        topMargin=54,
        bottomMargin=54
    )

    styles = getSampleStyleSheet()
    
    # Custom Typography Hierarchy
    cover_title = ParagraphStyle(
        'CoverTitle',
        parent=styles['Normal'],
        fontName='Helvetica-Bold',
        fontSize=26,
        leading=32,
        textColor=PRIMARY,
        alignment=0,
        spaceAfter=10
    )
    cover_sub = ParagraphStyle(
        'CoverSubtitle',
        parent=styles['Normal'],
        fontName='Helvetica',
        fontSize=12,
        leading=18,
        textColor=MUTED_TEXT,
        alignment=0,
        spaceAfter=25
    )
    h1_style = ParagraphStyle(
        'HandoverH1',
        parent=styles['Normal'],
        fontName='Helvetica-Bold',
        fontSize=16,
        leading=20,
        textColor=PRIMARY,
        spaceBefore=18,
        spaceAfter=8,
        keepWithNext=True
    )
    h2_style = ParagraphStyle(
        'HandoverH2',
        parent=styles['Normal'],
        fontName='Helvetica-Bold',
        fontSize=12,
        leading=16,
        textColor=PRIMARY_DARK,
        spaceBefore=12,
        spaceAfter=6,
        keepWithNext=True
    )
    h3_style = ParagraphStyle(
        'HandoverH3',
        parent=styles['Normal'],
        fontName='Helvetica-Bold',
        fontSize=10,
        leading=14,
        textColor=DARK_TEXT,
        spaceBefore=8,
        spaceAfter=4,
        keepWithNext=True
    )
    body_style = ParagraphStyle(
        'HandoverBody',
        parent=styles['Normal'],
        fontName='Helvetica',
        fontSize=9,
        leading=13.5,
        textColor=DARK_TEXT,
        spaceAfter=6
    )
    body_bold = ParagraphStyle(
        'HandoverBodyBold',
        parent=body_style,
        fontName='Helvetica-Bold'
    )
    bullet_style = ParagraphStyle(
        'HandoverBullet',
        parent=body_style,
        leftIndent=15,
        bulletIndent=5,
        spaceAfter=3
    )
    callout_style = ParagraphStyle(
        'HandoverCallout',
        parent=body_style,
        fontName='Helvetica',
        fontSize=8.5,
        leading=13,
        textColor=colors.HexColor("#991B1B")
    )
    code_style = ParagraphStyle(
        'HandoverCode',
        parent=body_style,
        fontName='Courier',
        fontSize=8,
        leading=11,
        textColor=colors.HexColor("#1F2937")
    )
    table_cell = ParagraphStyle(
        'TableCell',
        parent=styles['Normal'],
        fontName='Helvetica',
        fontSize=8,
        leading=11,
        textColor=DARK_TEXT
    )
    table_header = ParagraphStyle(
        'TableHeader',
        parent=styles['Normal'],
        fontName='Helvetica-Bold',
        fontSize=8,
        leading=11,
        textColor=colors.white
    )

    story = []

    # ══════════════════════════════════════════════════════════════════════════
    # COVER PAGE
    # ══════════════════════════════════════════════════════════════════════════
    story.append(Spacer(1, 40))
    story.append(Paragraph("MITTAI BANDI", ParagraphStyle('CoverBadge', fontName='Helvetica-Bold', fontSize=10, textColor=SECONDARY, leading=12, spaceAfter=8)))
    story.append(Paragraph("System Technical Architecture &amp; Client Handover Documentation", cover_title))
    story.append(Paragraph("Complete Technical Blueprint, Architecture, Cloud Infrastructure, Security Standards, Content Management System Guide, and Operational Procedures for the MITTAI BANDI Web Platform.", cover_sub))
    story.append(HRFlowable(width="100%", thickness=2, color=PRIMARY, spaceAfter=20, spaceBefore=0))

    meta_table_data = [
        [Paragraph("<b>Project:</b>", body_style), Paragraph("MITTAI BANDI Web Portal &amp; Administrative CMS", body_style)],
        [Paragraph("<b>Client Organization:</b>", body_style), Paragraph("GURMITRAA Technologies Pvt. Ltd., Rajahmundry, Andhra Pradesh", body_style)],
        [Paragraph("<b>Primary Domain:</b>", body_style), Paragraph("<code>https://www.mittaibandi.com</code>", body_style)],
        [Paragraph("<b>Administrative Portal:</b>", body_style), Paragraph("<code>https://www.mittaibandi.com/admin/login.html</code>", body_style)],
        [Paragraph("<b>GitHub Repository:</b>", body_style), Paragraph("<code>https://github.com/mittaibandiportal-dev/MITTAI-BANDI-PORTAL</code> (main)", body_style)],
        [Paragraph("<b>Cloud / Backend:</b>", body_style), Paragraph("Google Firebase (Auth &amp; Realtime Database) + Vercel Global Edge CDN", body_style)],
        [Paragraph("<b>Documentation Version:</b>", body_style), Paragraph("v2.2.0 (Comprehensive Release)", body_style)],
        [Paragraph("<b>Date of Handover:</b>", body_style), Paragraph(datetime.now().strftime("%B %d, %Y"), body_style)],
        [Paragraph("<b>Engineering Partner:</b>", body_style), Paragraph("<b>ARANEA DEN</b> (Software Architecture &amp; Digital Engineering)", body_style)]
    ]
    t_meta = Table(meta_table_data, colWidths=[130, 374])
    t_meta.setStyle(TableStyle([
        ('BACKGROUND', (0,0), (-1,-1), colors.HexColor("#F9FAFB")),
        ('BOX', (0,0), (-1,-1), 1, BORDER_COLOR),
        ('INNERGRID', (0,0), (-1,-1), 0.5, BORDER_COLOR),
        ('TOPPADDING', (0,0), (-1,-1), 5),
        ('BOTTOMPADDING', (0,0), (-1,-1), 5),
        ('LEFTPADDING', (0,0), (-1,-1), 10),
        ('RIGHTPADDING', (0,0), (-1,-1), 10),
    ]))
    story.append(t_meta)

    story.append(Spacer(1, 30))
    callout_box = [
        [Paragraph("<b>IMPORTANT NOTICE — CONFIDENTIAL SYSTEM HANDOVER</b><br/>This document contains architectural blueprints, database security rule mappings, and administrative workflow protocols. All secret keys, private passwords, and service account tokens have been sanitized in compliance with enterprise security protocols. Operational procedures for account ownership transfer and password initialization are detailed in Section 6.", callout_style)]
    ]
    t_call = Table(callout_box, colWidths=[504])
    t_call.setStyle(TableStyle([
        ('BACKGROUND', (0,0), (-1,-1), CALLOUT_BG),
        ('BOX', (0,0), (-1,-1), 1, CALLOUT_BORDER),
        ('TOPPADDING', (0,0), (-1,-1), 8),
        ('BOTTOMPADDING', (0,0), (-1,-1), 8),
        ('LEFTPADDING', (0,0), (-1,-1), 12),
        ('RIGHTPADDING', (0,0), (-1,-1), 12),
    ]))
    story.append(t_call)

    story.append(PageBreak())

    # ══════════════════════════════════════════════════════════════════════════
    # SECTION 1: PROJECT OVERVIEW
    # ══════════════════════════════════════════════════════════════════════════
    story.append(Paragraph("1. Project Overview &amp; Executive Summary", h1_style))
    story.append(HRFlowable(width="100%", thickness=1, color=PRIMARY, spaceAfter=8, spaceBefore=0))
    story.append(Paragraph(
        "<b>MITTAI BANDI</b> (<i>'Traditional Taste. Digital Convenience.'</i>) is a premier digital confectionery marketplace engineered for <b>GURMITRAA Technologies Pvt. Ltd.</b>, based in Rajahmundry, Andhra Pradesh, India. The platform bridges generational sweet makers and traditional confectioners with regional sweet lovers through a modern, mobile-first, and highly responsive web portal.",
        body_style
    ))
    story.append(Paragraph("<b>Core Business Objectives &amp; Features:</b>", h3_style))
    story.append(Paragraph("• <b>Dual Audience Marketplace:</b> Provides dedicated customer-facing storefront showcases while providing vendor onboarding pathways for artisan sweet makers.", bullet_style))
    story.append(Paragraph("• <b>Modern Content Management:</b> Full CMS administrative control allowing administrators to modify banners, brand messaging, pricing notices, office details, and legal documents in real time without code deployment.", bullet_style))
    story.append(Paragraph("• <b>Dynamic Video Hero:</b> YouTube-backed, autoplaying, looping responsive hero system with separate 16:9 desktop video and 9:16 mobile YouTube Shorts integration, supported by automatic image fallback.", bullet_style))
    story.append(Paragraph("• <b>Statutory &amp; Regulatory Compliance:</b> Full FSSAI licensing display (License #10125018000861), Corporate CIN (U72900AP2020PTC114398), Consumer Protection Act Grievance Redressal officer escalation matrix, and strict food safety advisory channels.", bullet_style))
    story.append(Paragraph("• <b>Multi-Device Optimization:</b> Engineered with sub-second loading speeds, zero render-blocking layout shifts, lazy-loaded visual assets, and full cross-browser reliability across desktop, iOS, and Android devices.", bullet_style))

    # ══════════════════════════════════════════════════════════════════════════
    # SECTION 2: TECHNOLOGY STACK
    # ══════════════════════════════════════════════════════════════════════════
    story.append(Spacer(1, 6))
    story.append(Paragraph("2. Technology Stack &amp; Architectural Specifications", h1_style))
    story.append(HRFlowable(width="100%", thickness=1, color=PRIMARY, spaceAfter=8, spaceBefore=0))
    story.append(Paragraph("The platform is engineered using a robust, decoupled JAMstack architecture. This delivers unmatched page rendering performance, near-zero hosting maintenance, enterprise-level security, and high uptime.", body_style))

    tech_table_data = [
        [Paragraph("Layer", table_header), Paragraph("Technology / Library", table_header), Paragraph("Purpose / Implementation Details", table_header)],
        [Paragraph("Frontend Core", table_cell), Paragraph("Semantic HTML5, CSS3 Variables, ES6+ Modular JavaScript", table_cell), Paragraph("Zero-framework vanilla implementation ensuring lightweight payloads, rapid DOM rendering, and no framework upgrade churn.", table_cell)],
        [Paragraph("Typography &amp; UI", table_cell), Paragraph("Google Fonts (Inter, Manrope), Lucide SVG Icons", table_cell), Paragraph("Premium luxury aesthetic with clear typography hierarchy and crisp vector iconography.", table_cell)],
        [Paragraph("Authentication", table_cell), Paragraph("Firebase Authentication (v10 Compat)", table_cell), Paragraph("Email/Password authentication hardened with Custom Claims (<code>admin: true</code>) and email whitelist protection.", table_cell)],
        [Paragraph("Database / CMS", table_cell), Paragraph("Firebase Realtime Database (RTDB)", table_cell), Paragraph("Sub-second JSON document store supporting dual live/draft environments, schema verification, and RESTful sync.", table_cell)],
        [Paragraph("Client-Side Optimization", table_cell), Paragraph("HTML5 Canvas Engine (<code>MB_CLOUDINARY</code>)", table_cell), Paragraph("In-browser image auto-compression, aspect ratio normalization, and WebP generation before database persistence.", table_cell)],
        [Paragraph("Hosting &amp; Routing", table_cell), Paragraph("Vercel Global Edge Network", table_cell), Paragraph("Global CDN hosting, automated GitHub CI/CD deployment, HTTP/2, automated SSL, and <code>vercel.json</code> clean URL routing.", table_cell)],
        [Paragraph("Local Dev Harness", table_cell), Paragraph("Node.js <code>serve</code> + PowerShell", table_cell), Paragraph("Lightweight zero-build development environment running clean URL rewrites locally via <code>serve.json</code>.", table_cell)]
    ]
    t_tech = Table(tech_table_data, colWidths=[90, 160, 254])
    t_tech.setStyle(TableStyle([
        ('BACKGROUND', (0,0), (-1,0), PRIMARY),
        ('BOX', (0,0), (-1,-1), 1, BORDER_COLOR),
        ('INNERGRID', (0,0), (-1,-1), 0.5, BORDER_COLOR),
        ('TOPPADDING', (0,0), (-1,-1), 4),
        ('BOTTOMPADDING', (0,0), (-1,-1), 4),
        ('LEFTPADDING', (0,0), (-1,-1), 6),
        ('RIGHTPADDING', (0,0), (-1,-1), 6),
    ]))
    story.append(t_tech)

    # ══════════════════════════════════════════════════════════════════════════
    # SECTION 3: CODEBASE ARCHITECTURE
    # ══════════════════════════════════════════════════════════════════════════
    story.append(Spacer(1, 6))
    story.append(Paragraph("3. Codebase Architecture &amp; File Organization", h1_style))
    story.append(HRFlowable(width="100%", thickness=1, color=PRIMARY, spaceAfter=8, spaceBefore=0))
    story.append(Paragraph("The codebase is organized cleanly to separate public website routes, administrative modules, visual styles, and cloud integrations:", body_style))

    code_tree = """<b>Root Directory Structure:</b>
├── index.html                   # Public Homepage (Hero, Categories, Regional, How it Works)
├── about.html                   # Corporate About Us & Brand Heritage Page
├── partner.html                 # Sweet Maker & Delivery Partner Onboarding Page
├── contact.html                 # Customer Support, Escalation, FSSAI & Office Details
├── privacy-policy.html          # Statutory Privacy Policy Document
├── terms-of-service.html        # Public Terms of Service Document
├── cancellation-refund.html     # Cancellation, Refund & Replacement Policy
├── api-policy.html              # API & Integration Policy Document
├── 404.html                     # Custom 404 Error Handler Page
├── vercel.json                  # Production Edge clean URLs & 301/308 redirect rules
├── firebase.json                # Firebase RTDB rules & fallback hosting config
├── serve.json                   # Local development server clean URL redirect matrix
├── database.rules.json          # Server-side Firebase Realtime Database Security Rules
├── admin/                       # Administrative Management Application
│   ├── index.html               # Multi-Module Admin Dashboard UI
│   ├── login.html               # Authenticated Administrator Sign-in Portal
│   ├── css/admin.css            # Comprehensive CMS Layout, Sidebar & Form Styles
│   └── js/
│       ├── admin-auth.js        # Firebase Auth state manager, session guardian & router
│       ├── admin-cms.js         # Core CMS Controller (Draft, Publish, 17+ Editor Modules)
│       └── login-page.js        # Login form controller & password reset dispatcher
├── assets/
│   ├── css/                     # Modulated Design System Stylesheets
│   │   ├── design-system.css    # Color tokens, typography, grid, buttons, animations
│   │   ├── home.css             # Homepage-specific visual components
│   │   ├── about.css            # Corporate About Us cards, vision, grid styling
│   │   ├── partner.css          # Partner onboarding, comparison cards & vendor forms
│   │   └── contact.css          # Support channel cards, grievance & escalation timeline
│   ├── js/
│   │   ├── cms-client.js        # Public Website Client: Hydrates all pages from Live RTDB
│   │   ├── cms-default-data.js  # Production fallback JSON snapshot schema
│   │   ├── cloudinary.js        # HTML5 Canvas image compression & data URL engine
│   │   ├── firebase.js          # Client-side Firebase RTDB form dispatcher
│   │   └── main.js              # Header scroll, mobile drawer, FAQ accordion, observer
│   └── images/ & sweets/        # High-resolution optimized brand logos, sweets & banners
└── tools/
    └── admin-claims/            # Node.js Firebase Admin SDK custom claims assigner"""

    story.append(Paragraph(code_tree.replace('\n', '<br/>').replace(' ', '&nbsp;'), code_style))

    story.append(PageBreak())

    # ══════════════════════════════════════════════════════════════════════════
    # SECTION 4: WEBSITE PAGES & FUNCTIONALITIES
    # ══════════════════════════════════════════════════════════════════════════
    story.append(Paragraph("4. Website Pages &amp; Section-Wise Architecture", h1_style))
    story.append(HRFlowable(width="100%", thickness=1, color=PRIMARY, spaceAfter=8, spaceBefore=0))

    pages_data = [
        [Paragraph("Page &amp; Route", table_header), Paragraph("Key Functional Sections", table_header), Paragraph("CMS Controllability &amp; Dynamic Data", table_header)],
        [
            Paragraph("<b>Home</b><br/><code>/</code>", table_cell),
            Paragraph("• Responsive YouTube Hero Video (Desktop 16:9 / Mobile 9:16 Shorts)<br/>• Dual Hero CTA Buttons &amp; Dynamic Fallback Poster<br/>• Promotional Banners Carousel<br/>• Curated Collections (6 Sweets Categories)<br/>• Regional Flavours Spotlight &amp; How It Works<br/>• Mobile App Download Section with QR &amp; Badges", table_cell),
            Paragraph("Fully controllable via <b>Hero Management</b>, <b>Banner Management</b>, and <b>App Links</b> CMS modules. All headlines, links, videos, and badges sync automatically.", table_cell)
        ],
        [
            Paragraph("<b>About Us</b><br/><code>/about</code>", table_cell),
            Paragraph("• Brand Origin &amp; Heritage Narrative<br/>• Mission &amp; Vision Cards<br/>• Corporate Overview (#EAF4FA Sky-Blue Card)<br/>• Artisan Sweet Making Commitment<br/>• Dual Audience Community Spotlight", table_cell),
            Paragraph("Managed via <b>About Us Management</b> module. Background colors, narrative paragraphs, company registration information, and partner CTA links are editable.", table_cell)
        ],
        [
            Paragraph("<b>Partner With Us</b><br/><code>/partner</code>", table_cell),
            Paragraph("• Sweet Maker / Vendor Onboarding (Android &amp; iOS)<br/>• Delivery Partner Network (Android Google Play)<br/>• Interactive Multi-Field Partner Registration Form<br/>• 3-Step Simple Partnership Journey", table_cell),
            Paragraph("Managed via <b>Partner Management</b> module. Registrations stream directly to <code>partner_registrations</code> in Firebase RTDB with instant admin alerts.", table_cell)
        ],
        [
            Paragraph("<b>Contact &amp; Support</b><br/><code>/contact</code>", table_cell),
            Paragraph("• 6 Dedicated Support Channel Cards (Orders, Legal, Hygiene, etc.)<br/>• Dual Support Panels (Orders Help &amp; Vendor Onboarding)<br/>• Food Safety &amp; Health Commitment Advisory<br/>• 4-Stage Complaint Escalation Matrix<br/>• Statutory Grievance Redressal Officer Profile<br/>• Registered Office Card with <b>FSSAI License #10125018000861</b><br/>• Anti-Fraud Security Notice", table_cell),
            Paragraph("100% mapped and controllable via <b>Contact Management</b> CMS module. Every phone number, email, FSSAI number, response time SLA, and grievance officer detail is editable.", table_cell)
        ],
        [
            Paragraph("<b>Legal Documents</b><br/><code>/privacy-policy</code><br/><code>/terms-of-service</code><br/><code>/cancellation-refund</code><br/><code>/api-policy</code>", table_cell),
            Paragraph("• Full Indian Legal &amp; IT Act Statutory Compliance<br/>• Global Visibility Toggle (e.g. toggle API Policy on/off)<br/>• Document effective date &amp; update metadata tracking<br/>• Clean formatted clauses and legal callout boxes", table_cell),
            Paragraph("Managed via <b>Legal Documents</b> CMS module with dual Visual Rich-Text and HTML Source editors. Switching a document OFF cleanly suppresses all public links globally.", table_cell)
        ],
        [
            Paragraph("<b>404 Error Page</b><br/><code>/404</code>", table_cell),
            Paragraph("• Branded empty sweet box illustration &amp; error messaging<br/>• Quick return links to Homepage and Support", table_cell),
            Paragraph("Managed via <b>Page Management → 404 Page</b> module.", table_cell)
        ]
    ]
    t_pages = Table(pages_data, colWidths=[90, 224, 190])
    t_pages.setStyle(TableStyle([
        ('BACKGROUND', (0,0), (-1,0), PRIMARY),
        ('BOX', (0,0), (-1,-1), 1, BORDER_COLOR),
        ('INNERGRID', (0,0), (-1,-1), 0.5, BORDER_COLOR),
        ('TOPPADDING', (0,0), (-1,-1), 4),
        ('BOTTOMPADDING', (0,0), (-1,-1), 4),
        ('LEFTPADDING', (0,0), (-1,-1), 6),
        ('RIGHTPADDING', (0,0), (-1,-1), 6),
    ]))
    story.append(t_pages)

    # ══════════════════════════════════════════════════════════════════════════
    # SECTION 5: CMS ADMIN DASHBOARD
    # ══════════════════════════════════════════════════════════════════════════
    story.append(Spacer(1, 6))
    story.append(Paragraph("5. CMS Admin Dashboard &amp; Administrative Capabilities", h1_style))
    story.append(HRFlowable(width="100%", thickness=1, color=PRIMARY, spaceAfter=8, spaceBefore=0))
    story.append(Paragraph(
        "The MITTAI BANDI Administrative Dashboard is accessible at <code>https://www.mittaibandi.com/admin/login.html</code>. It provides non-technical administrators with an intuitive SaaS workspace to update portal content in real time. The dashboard contains <b>17 specialized modules</b> organized into four logical clusters:",
        body_style
    ))

    modules_data = [
        [Paragraph("Cluster", table_header), Paragraph("Module Name", table_header), Paragraph("Key Operational Features", table_header)],
        [Paragraph("1. Core &amp; Content", table_cell), Paragraph("Dashboard Overview", table_cell), Paragraph("System health metrics, published version counter, total active banners, and quick publishing actions.", table_cell)],
        [Paragraph("1. Core &amp; Content", table_cell), Paragraph("Hero Management", table_cell), Paragraph("Independent YouTube URLs for Desktop (16:9) &amp; Mobile (9:16 Shorts), fallback image toggles, and live viewport preview.", table_cell)],
        [Paragraph("1. Core &amp; Content", table_cell), Paragraph("Banner Management", table_cell), Paragraph("Create, reorder, schedule, and activate promotional carousel campaigns with primary/secondary CTA buttons.", table_cell)],
        [Paragraph("1. Core &amp; Content", table_cell), Paragraph("Image Library", table_cell), Paragraph("Centralized catalog of all uploaded imagery with automated Canvas WebP compression, tag filters, and asset URL copying.", table_cell)],
        [Paragraph("2. Page Modules", table_cell), Paragraph("Page Management", table_cell), Paragraph("High-level SEO metadata, page slugs, meta titles, descriptions, and 404 error page customizations.", table_cell)],
        [Paragraph("2. Page Modules", table_cell), Paragraph("About Us Management", table_cell), Paragraph("Hero text, brand story paragraphs, mission/vision, corporate card info, and team heritage information.", table_cell)],
        [Paragraph("2. Page Modules", table_cell), Paragraph("Partner Management", table_cell), Paragraph("Vendor &amp; Delivery partner features, app store download links, and onboarding registration form labels.", table_cell)],
        [Paragraph("2. Page Modules", table_cell), Paragraph("Contact Management", table_cell), Paragraph("All 8 Contact Page sections: 6 support cards, dual support panels, food safety, escalation matrix, grievance officer, and FSSAI license.", table_cell)],
        [Paragraph("3. Footer, Legal &amp; Apps", table_cell), Paragraph("Footer Management", table_cell), Paragraph("Legal entity name, copyright notice, corporate address, footer navigation columns, and social links.", table_cell)],
        [Paragraph("3. Footer, Legal &amp; Apps", table_cell), Paragraph("Legal Documents", table_cell), Paragraph("WYSIWYG Visual and HTML Source editors for Privacy, Terms, Refund, and API policies with global visibility switches.", table_cell)],
        [Paragraph("3. Footer, Legal &amp; Apps", table_cell), Paragraph("App Links Management", table_cell), Paragraph("Direct management of customer, vendor, and delivery partner Google Play and Apple App Store URLs.", table_cell)],
        [Paragraph("4. Brand &amp; Settings", table_cell), Paragraph("Header &amp; Nav / Branding", table_cell), Paragraph("Navbar links, brand logo, favicon, preloader screen timing, and theme brand color configurations.", table_cell)],
        [Paragraph("4. Brand &amp; Settings", table_cell), Paragraph("Form Enquiries / Audit Logs", table_cell), Paragraph("Real-time viewer for customer contact submissions, partner registrations, and administrative audit history logs.", table_cell)]
    ]
    t_mod = Table(modules_data, colWidths=[90, 140, 274])
    t_mod.setStyle(TableStyle([
        ('BACKGROUND', (0,0), (-1,0), PRIMARY),
        ('BOX', (0,0), (-1,-1), 1, BORDER_COLOR),
        ('INNERGRID', (0,0), (-1,-1), 0.5, BORDER_COLOR),
        ('TOPPADDING', (0,0), (-1,-1), 4),
        ('BOTTOMPADDING', (0,0), (-1,-1), 4),
        ('LEFTPADDING', (0,0), (-1,-1), 6),
        ('RIGHTPADDING', (0,0), (-1,-1), 6),
    ]))
    story.append(t_mod)

    story.append(PageBreak())

    # ══════════════════════════════════════════════════════════════════════════
    # SECTION 6: ADMIN CREDENTIALS & SECURITY
    # ══════════════════════════════════════════════════════════════════════════
    story.append(Paragraph("6. Administrator Credentials &amp; Security Protocols", h1_style))
    story.append(HRFlowable(width="100%", thickness=1, color=PRIMARY, spaceAfter=8, spaceBefore=0))
    story.append(Paragraph(
        "Administrative access to the MITTAI BANDI CMS is protected by an enterprise-grade authentication model powered by <b>Firebase Authentication</b>. There are <b>no hardcoded credentials</b>, no plain-text passwords, and no insecure local credentials in the code.",
        body_style
    ))

    cred_box = [
        [Paragraph("<b>AUTHENTICATED PRIMARY ADMINISTRATOR ACCOUNT</b>", body_bold)],
        [Paragraph("• <b>Designated Admin Email:</b> <code>mittaibandiportal@gmail.com</code><br/>• <b>Firebase Project ID:</b> <code>mittaibandi-portal</code><br/>• <b>Administrative URL:</b> <code>https://www.mittaibandi.com/admin/login.html</code><br/>• <b>Authorization Model:</b> Firebase Custom Claim (<code>admin: true</code>) enforced at database security rules.<br/>• <b>Password Security:</b> Managed directly by Firebase Auth. Never transmitted or logged in plain-text.", body_style)]
    ]
    t_cred = Table(cred_box, colWidths=[504])
    t_cred.setStyle(TableStyle([
        ('BACKGROUND', (0,0), (-1,-1), colors.HexColor("#F0FDF4")),
        ('BOX', (0,0), (-1,-1), 1, colors.HexColor("#BBF7D0")),
        ('TOPPADDING', (0,0), (-1,-1), 6),
        ('BOTTOMPADDING', (0,0), (-1,-1), 6),
        ('LEFTPADDING', (0,0), (-1,-1), 10),
        ('RIGHTPADDING', (0,0), (-1,-1), 10),
    ]))
    story.append(t_cred)

    story.append(Spacer(1, 8))
    story.append(Paragraph("<b>Password Setup &amp; Reset Procedure:</b>", h2_style))
    story.append(Paragraph("1. Open <code>https://www.mittaibandi.com/admin/login.html</code> in any web browser.", bullet_style))
    story.append(Paragraph("2. Click on the <b>'Forgot Password?'</b> link located above the password input field.", bullet_style))
    story.append(Paragraph("3. Enter the registered administrator email: <code>mittaibandiportal@gmail.com</code> and click <b>Send Password Reset Link</b>.", bullet_style))
    story.append(Paragraph("4. Firebase Authentication immediately dispatches an official, cryptographically secure password reset email to the client inbox.", bullet_style))
    story.append(Paragraph("5. Click the link in the email, enter your new strong password (minimum 8 characters, alphanumeric), and confirm.", bullet_style))
    story.append(Paragraph("6. Return to the Admin Login page and sign in immediately with your updated credentials.", bullet_style))

    story.append(Spacer(1, 8))
    story.append(Paragraph("<b>Firebase Custom Claims Verification (Admin Authorization):</b>", h2_style))
    story.append(Paragraph(
        "To prevent non-administrative accounts from accessing CMS database nodes, Firebase requires the custom token claim <code>admin: true</code>. A dedicated Node.js maintenance tool is included in the codebase at <code>tools/admin-claims/set-admin-claim.mjs</code>. Administrators can run this in Google Cloud Shell or any secure environment holding the service account:",
        body_style
    ))
    story.append(Paragraph("<code>node tools/admin-claims/set-admin-claim.mjs mittaibandiportal@gmail.com</code>", code_style))
    story.append(Paragraph("The script preserves all existing account metadata, sets <code>{ admin: true }</code> on the user's UID, and outputs verification confirmation.", body_style))

    # ══════════════════════════════════════════════════════════════════════════
    # SECTION 7: IMAGE & VIDEO MANAGEMENT
    # ══════════════════════════════════════════════════════════════════════════
    story.append(Spacer(1, 6))
    story.append(Paragraph("7. Media, Image &amp; Video Management Architecture", h1_style))
    story.append(HRFlowable(width="100%", thickness=1, color=PRIMARY, spaceAfter=8, spaceBefore=0))
    story.append(Paragraph(
        "<b>Actual Implementation Status:</b> The portal implements a high-performance, client-side HTML5 Canvas compression engine (<code>MB_CLOUDINARY</code> in <code>assets/js/cloudinary.js</code>) combined with direct Firebase RTDB persistence. This eliminates third-party image upload failures (such as Cloudinary 400 preset errors) and ensures instant, reliable image updates without incurring recurring SaaS fees.",
        body_style
    ))

    media_specs = [
        [Paragraph("Asset Location", table_header), Paragraph("Recommended Dimensions", table_header), Paragraph("Aspect Ratio", table_header), Paragraph("Format &amp; Guidelines", table_header)],
        [Paragraph("Desktop Hero Poster", table_cell), Paragraph("1920 x 1080 px (Min 1280x720)", table_cell), Paragraph("16:9 Landscape", table_cell), Paragraph("WebP / JPG. Under 350 KB. Displays if YouTube video fails to load.", table_cell)],
        [Paragraph("Mobile Hero Poster", table_cell), Paragraph("1080 x 1920 px (Min 720x1280)", table_cell), Paragraph("9:16 Portrait", table_cell), Paragraph("WebP / JPG. Under 250 KB. Formatted for mobile vertical screens.", table_cell)],
        [Paragraph("Promotional Banners", table_cell), Paragraph("1400 x 600 px", table_cell), Paragraph("21:9 or 16:7 Banner", table_cell), Paragraph("Rich sweet presentation with central subject placement.", table_cell)],
        [Paragraph("Sweets / Categories", table_cell), Paragraph("800 x 800 px", table_cell), Paragraph("1:1 Square", table_cell), Paragraph("Clean background, high vibrance, authentic sweet closeups.", table_cell)],
        [Paragraph("Brand Logo / Favicon", table_cell), Paragraph("512 x 512 px / 64 x 64 px", table_cell), Paragraph("1:1 Square", table_cell), Paragraph("PNG with transparency or high-contrast JPG.", table_cell)]
    ]
    t_med = Table(media_specs, colWidths=[105, 125, 84, 190])
    t_med.setStyle(TableStyle([
        ('BACKGROUND', (0,0), (-1,0), PRIMARY),
        ('BOX', (0,0), (-1,-1), 1, BORDER_COLOR),
        ('INNERGRID', (0,0), (-1,-1), 0.5, BORDER_COLOR),
        ('TOPPADDING', (0,0), (-1,-1), 4),
        ('BOTTOMPADDING', (0,0), (-1,-1), 4),
        ('LEFTPADDING', (0,0), (-1,-1), 6),
        ('RIGHTPADDING', (0,0), (-1,-1), 6),
    ]))
    story.append(t_med)

    story.append(Spacer(1, 6))
    story.append(Paragraph("<b>YouTube Video Integration &amp; Fallback Rules:</b>", h3_style))
    story.append(Paragraph("• <b>Dual Video System:</b> The CMS provides separate YouTube input fields for Desktop (16:9 standard video) and Mobile (9:16 vertical Shorts video).", bullet_style))
    story.append(Paragraph("• <b>Flexible URL Parsing:</b> Accepts standard watch URLs (<code>youtube.com/watch?v=...</code>), short links (<code>youtu.be/...</code>), Shorts URLs (<code>youtube.com/shorts/...</code>), or raw 11-character video IDs.", bullet_style))
    story.append(Paragraph("• <b>Automatic Fallback:</b> If YouTube playback is blocked, unavailable, offline, or takes over 4.5 seconds to load, the frontend seamlessly renders the matching desktop/mobile fallback poster image. The website never shows a blank hero.", bullet_style))

    story.append(PageBreak())

    # ══════════════════════════════════════════════════════════════════════════
    # SECTION 8: DATABASE & BACKEND
    # ══════════════════════════════════════════════════════════════════════════
    story.append(Paragraph("8. Database Architecture &amp; Security Rules", h1_style))
    story.append(HRFlowable(width="100%", thickness=1, color=PRIMARY, spaceAfter=8, spaceBefore=0))
    story.append(Paragraph("The platform uses <b>Firebase Realtime Database (RTDB)</b> hosted in Asia-Southeast1. The database employs a dual-stage publishing model ensuring content safety:", body_style))

    rtdb_tree = """<b>Firebase Realtime Database Schema:</b>
https://mittaibandi-portal-default-rtdb.asia-southeast1.firebasedatabase.app
├── cms/
│   ├── live/                 # Publicly readable live website content (synced to visitors)
│   │   ├── global/           # Site name, logos, contact info, social links, theme colors
│   │   ├── pages/            # Page-specific content (home, about, partner, contact, 404)
│   │   ├── promotionalBanners# Active promotional campaign banner array
│   │   ├── legalDocuments/   # Privacy, Terms, Refund, API policy content & active flags
│   │   └── meta/             # Published version number, timestamp, publisher identity
│   ├── draft/                # Working staging environment (read/write by admin only)
│   ├── media/                # Admin image library metadata catalog & data URLs
│   └── history/              # Activity audit log tracking every save, publish, and login event
├── contact_submissions/      # Public write-only / Admin read-only customer inquiries
└── partner_registrations/    # Public write-only / Admin read-only vendor & delivery applications"""

    story.append(Paragraph(rtdb_tree.replace('\n', '<br/>').replace(' ', '&nbsp;'), code_style))

    story.append(Spacer(1, 8))
    story.append(Paragraph("<b>Security Rules Enforcement (database.rules.json):</b>", h3_style))
    story.append(Paragraph("• <code>/cms/live</code> is publicly readable (<code>.read: true</code>) so customers load content instantly, but strictly write-restricted to authenticated administrators (<code>auth.token.admin === true || auth.token.email === 'mittaibandiportal@gmail.com'</code>).", bullet_style))
    story.append(Paragraph("• <code>/cms/draft</code>, <code>/cms/media</code>, and <code>/cms/history</code> are strictly private and accessible only to verified administrators.", bullet_style))
    story.append(Paragraph("• <code>/contact_submissions</code> and <code>/partner_registrations</code> allow public creation with strict payload validation (enforcing character limits, required fields, and preventing tampering), while read access is restricted exclusively to administrators.", bullet_style))

    # ══════════════════════════════════════════════════════════════════════════
    # SECTION 9: HOSTING & DEPLOYMENT
    # ══════════════════════════════════════════════════════════════════════════
    story.append(Spacer(1, 6))
    story.append(Paragraph("9. Hosting, Deployment &amp; Domain Configuration", h1_style))
    story.append(HRFlowable(width="100%", thickness=1, color=PRIMARY, spaceAfter=8, spaceBefore=0))

    host_data = [
        [Paragraph("Parameter", table_header), Paragraph("Active Production Setting", table_header), Paragraph("Operational Notes", table_header)],
        [Paragraph("Hosting Provider", table_cell), Paragraph("<b>Vercel Global Edge Network</b>", table_cell), Paragraph("Automated serverless edge delivery, DDoS mitigation, and global asset caching.", table_cell)],
        [Paragraph("Live Production Domain", table_cell), Paragraph("<code>https://www.mittaibandi.com</code>", table_cell), Paragraph("Apex domain <code>mittaibandi.com</code> automatically redirects (308) to <code>www</code>.", table_cell)],
        [Paragraph("SSL / TLS Encryption", table_cell), Paragraph("Automated Let's Encrypt (TLS 1.3)", table_cell), Paragraph("Zero-maintenance auto-renewing SSL certificate managed at Vercel edge.", table_cell)],
        [Paragraph("Routing &amp; Clean URLs", table_cell), Paragraph("<code>vercel.json</code> + <code>serve.json</code>", table_cell), Paragraph("Removes <code>.html</code> extensions. Legacy <code>.html</code> requests automatically redirect (301/308).", table_cell)],
        [Paragraph("Continuous Deployment", table_cell), Paragraph("GitHub Repository Integration", table_cell), Paragraph("Pushing commits to <code>main</code> branch triggers instantaneous Vercel production rebuild.", table_cell)]
    ]
    t_host = Table(host_data, colWidths=[110, 180, 214])
    t_host.setStyle(TableStyle([
        ('BACKGROUND', (0,0), (-1,0), PRIMARY),
        ('BOX', (0,0), (-1,-1), 1, BORDER_COLOR),
        ('INNERGRID', (0,0), (-1,-1), 0.5, BORDER_COLOR),
        ('TOPPADDING', (0,0), (-1,-1), 4),
        ('BOTTOMPADDING', (0,0), (-1,-1), 4),
        ('LEFTPADDING', (0,0), (-1,-1), 6),
        ('RIGHTPADDING', (0,0), (-1,-1), 6),
    ]))
    story.append(t_host)

    # ══════════════════════════════════════════════════════════════════════════
    # SECTION 10: GITHUB WORKFLOW
    # ══════════════════════════════════════════════════════════════════════════
    story.append(Spacer(1, 6))
    story.append(Paragraph("10. GitHub Version Control &amp; Rollback Protocols", h1_style))
    story.append(HRFlowable(width="100%", thickness=1, color=PRIMARY, spaceAfter=8, spaceBefore=0))
    story.append(Paragraph("The source code is maintained in GitHub at <code>https://github.com/mittaibandiportal-dev/MITTAI-BANDI-PORTAL</code> on the <code>main</code> production branch.", body_style))
    story.append(Paragraph("<b>Standard Engineering Workflow Commands:</b>", h3_style))
    story.append(Paragraph("<code># 1. Pull latest changes from remote<br/>git pull origin main<br/><br/># 2. Stage modified files<br/>git add .<br/><br/># 3. Create descriptive commit<br/>git commit -m \"Update hero banner content and partner links\"<br/><br/># 4. Deploy live via push<br/>git push origin main</code>", code_style))
    story.append(Paragraph("<b>Instant Rollback Procedure:</b> If an erroneous commit is pushed, administrators can instantly roll back in Vercel Dashboard → Deployments by clicking 'Promote to Production' on any previous successful build, or revert via Git using: <code>git revert HEAD &amp;&amp; git push origin main</code>.", body_style))

    story.append(PageBreak())

    # ══════════════════════════════════════════════════════════════════════════
    # SECTION 11: WEBSITE WORKFLOW
    # ══════════════════════════════════════════════════════════════════════════
    story.append(Paragraph("11. Content Publishing Lifecycle &amp; Quality Assurance", h1_style))
    story.append(HRFlowable(width="100%", thickness=1, color=PRIMARY, spaceAfter=8, spaceBefore=0))
    story.append(Paragraph(
        "To ensure zero website disruption, content changes pass through an isolated <b>Edit → Draft → Preview → Publish</b> pipeline before reaching end customers:",
        body_style
    ))

    flow_data = [
        [Paragraph("Step", table_header), Paragraph("Phase", table_header), Paragraph("Action &amp; System Behavior", table_header)],
        [Paragraph("Step 1", table_cell), Paragraph("Sign In", table_cell), Paragraph("Admin logs into <code>/admin/login.html</code> using Firebase authenticated credentials.", table_cell)],
        [Paragraph("Step 2", table_cell), Paragraph("Edit Module", table_cell), Paragraph("Admin selects the target module (e.g., Contact, Hero, Banners, About Us) and modifies text, images, or toggles.", table_cell)],
        [Paragraph("Step 3", table_cell), Paragraph("Save Draft", table_cell), Paragraph("Clicking <b>'Save Draft'</b> saves changes exclusively to Firebase <code>/cms/draft</code>. Public website remains 100% unaffected.", table_cell)],
        [Paragraph("Step 4", table_cell), Paragraph("Live Preview", table_cell), Paragraph("Clicking <b>'Live Preview'</b> launches an interactive modal displaying Desktop, Tablet, and Mobile views with draft content.", table_cell)],
        [Paragraph("Step 5", table_cell), Paragraph("Publish Live", table_cell), Paragraph("Clicking <b>'Publish Changes'</b> increments version, syncs draft to <code>/cms/live</code>, logs audit entry, and refreshes the live portal.", table_cell)],
        [Paragraph("Step 6", table_cell), Paragraph("Live Verification", table_cell), Paragraph("Admin opens <code>https://www.mittaibandi.com</code> to verify updates live across all devices.", table_cell)]
    ]
    t_flow = Table(flow_data, colWidths=[50, 95, 359])
    t_flow.setStyle(TableStyle([
        ('BACKGROUND', (0,0), (-1,0), PRIMARY),
        ('BOX', (0,0), (-1,-1), 1, BORDER_COLOR),
        ('INNERGRID', (0,0), (-1,-1), 0.5, BORDER_COLOR),
        ('TOPPADDING', (0,0), (-1,-1), 4),
        ('BOTTOMPADDING', (0,0), (-1,-1), 4),
        ('LEFTPADDING', (0,0), (-1,-1), 6),
        ('RIGHTPADDING', (0,0), (-1,-1), 6),
    ]))
    story.append(t_flow)

    # ══════════════════════════════════════════════════════════════════════════
    # SECTION 12: FORMS & NOTIFICATIONS
    # ══════════════════════════════════════════════════════════════════════════
    story.append(Spacer(1, 6))
    story.append(Paragraph("12. Customer Inquiries &amp; Partner Registration Architecture", h1_style))
    story.append(HRFlowable(width="100%", thickness=1, color=PRIMARY, spaceAfter=8, spaceBefore=0))
    story.append(Paragraph("Customer submissions are handled seamlessly through dual-storage persistence to guarantee zero inquiry loss:", body_style))
    story.append(Paragraph("• <b>Contact Inquiries (General Support):</b> Customer entries on the Contact page are validated client-side, submitted to Firebase RTDB node <code>contact_submissions</code>, and surfaced inside the Admin CMS <b>'Form Enquiries'</b> module.", bullet_style))
    story.append(Paragraph("• <b>Partner Registrations (Vendors &amp; Delivery):</b> Prospective sweet makers submit shop name, owner name, location, FSSAI number, and contact info. Stored in Firebase RTDB node <code>partner_registrations</code> with full audit timestamps.", bullet_style))
    story.append(Paragraph("• <b>Email Notification Bridge:</b> Direct <code>mailto:</code> links are integrated across all six support cards (e.g. <code>order@mittaibandi.com</code>, <code>info@mittaibandi.com</code>, <code>hygiene@mittaibandi.com</code>, <code>legal@mittaibandi.com</code>) ensuring customers can reach specialized departments directly.", bullet_style))

    # ══════════════════════════════════════════════════════════════════════════
    # SECTION 13: MAINTENANCE & TROUBLESHOOTING
    # ══════════════════════════════════════════════════════════════════════════
    story.append(Spacer(1, 6))
    story.append(Paragraph("13. Operational Maintenance &amp; Troubleshooting Guide", h1_style))
    story.append(HRFlowable(width="100%", thickness=1, color=PRIMARY, spaceAfter=8, spaceBefore=0))

    trouble_data = [
        [Paragraph("Observed Symptom", table_header), Paragraph("Probable Root Cause", table_header), Paragraph("Standard Remediation Step", table_header)],
        [
            Paragraph("Admin panel shows white screen", table_cell),
            Paragraph("Browser cached legacy session or pending auth promise", table_cell),
            Paragraph("Open <code>/admin/login.html</code> directly. Clear browser session storage for <code>mittaibandi.com</code>.", table_cell)
        ],
        [
            Paragraph("Hero video shows fallback image", table_cell),
            Paragraph("YouTube video ID incorrect or restricted embedding", table_cell),
            Paragraph("Verify video is set to 'Public' or 'Unlisted' on YouTube and allows embedding. Re-save URL in Hero CMS.", table_cell)
        ],
        [
            Paragraph("404 Error when refreshing page", table_cell),
            Paragraph("Hosting clean URL rules bypassed or altered", table_cell),
            Paragraph("Ensure <code>vercel.json</code> exists on root with <code>\"cleanUrls\": true</code> and deploy to Vercel.", table_cell)
        ],
        [
            Paragraph("Database permission denied error", table_cell),
            Paragraph("Admin custom claim expired or token out-of-sync", table_cell),
            Paragraph("Log out of CMS and log back in to force-refresh Firebase ID token. Run <code>set-admin-claim.mjs</code> if needed.", table_cell)
        ]
    ]
    t_trouble = Table(trouble_data, colWidths=[120, 150, 234])
    t_trouble.setStyle(TableStyle([
        ('BACKGROUND', (0,0), (-1,0), PRIMARY),
        ('BOX', (0,0), (-1,-1), 1, BORDER_COLOR),
        ('INNERGRID', (0,0), (-1,-1), 0.5, BORDER_COLOR),
        ('TOPPADDING', (0,0), (-1,-1), 4),
        ('BOTTOMPADDING', (0,0), (-1,-1), 4),
        ('LEFTPADDING', (0,0), (-1,-1), 6),
        ('RIGHTPADDING', (0,0), (-1,-1), 6),
    ]))
    story.append(t_trouble)

    story.append(PageBreak())

    # ══════════════════════════════════════════════════════════════════════════
    # SECTION 14: OWNERSHIP & HANDOVER
    # ══════════════════════════════════════════════════════════════════════════
    story.append(Paragraph("14. Service Ownership &amp; Asset Handover Matrix", h1_style))
    story.append(HRFlowable(width="100%", thickness=1, color=PRIMARY, spaceAfter=8, spaceBefore=0))
    story.append(Paragraph(
        "All digital assets, source code repositories, databases, domains, and cloud accounts are the sole intellectual and operational property of <b>GURMITRAA Technologies Pvt. Ltd.</b> The inventory below details all client accounts required for ongoing ownership:",
        body_style
    ))

    owner_data = [
        [Paragraph("Service / Asset", table_header), Paragraph("Account Owner / Identity", table_header), Paragraph("Access Role / Handover Status", table_header)],
        [Paragraph("Domain Registrar", table_cell), Paragraph("<code>mittaibandi.com</code> (Client Registrar)", table_cell), Paragraph("Owner Access (DNS A/CNAME pointed to Vercel edge: <code>76.76.21.21</code>).", table_cell)],
        [Paragraph("Cloud Hosting", table_cell), Paragraph("Vercel Team / Project: <code>mittai-bandi-portal</code>", table_cell), Paragraph("Owner Access. Continuous deployment connected to GitHub main branch.", table_cell)],
        [Paragraph("Database &amp; Auth", table_cell), Paragraph("Google Firebase: <code>mittaibandi-portal</code>", table_cell), Paragraph("Owner Access (Google Cloud Project <code>mittaibandi-portal</code>).", table_cell)],
        [Paragraph("Source Code Repo", table_cell), Paragraph("GitHub: <code>mittaibandiportal-dev/MITTAI-BANDI-PORTAL</code>", table_cell), Paragraph("Full Admin / Owner Access (Main production branch).", table_cell)],
        [Paragraph("Primary Admin Email", table_cell), Paragraph("<code>mittaibandiportal@gmail.com</code>", table_cell), Paragraph("Super Administrator role across CMS and Firebase Auth.", table_cell)]
    ]
    t_owner = Table(owner_data, colWidths=[110, 180, 214])
    t_owner.setStyle(TableStyle([
        ('BACKGROUND', (0,0), (-1,0), PRIMARY),
        ('BOX', (0,0), (-1,-1), 1, BORDER_COLOR),
        ('INNERGRID', (0,0), (-1,-1), 0.5, BORDER_COLOR),
        ('TOPPADDING', (0,0), (-1,-1), 4),
        ('BOTTOMPADDING', (0,0), (-1,-1), 4),
        ('LEFTPADDING', (0,0), (-1,-1), 6),
        ('RIGHTPADDING', (0,0), (-1,-1), 6),
    ]))
    story.append(t_owner)

    # ══════════════════════════════════════════════════════════════════════════
    # CLOSING THANKS NOTE FROM ARANEA DEN
    # ══════════════════════════════════════════════════════════════════════════
    story.append(Spacer(1, 20))
    thanks_box = [
        [Paragraph("<font color='#C9003D' size='12'><b>A SINCERE NOTE OF APPRECIATION FROM ARANEA DEN</b></font><br/><br/>"
                   "It has been an absolute honor and pleasure for the entire team at <b>ARANEA DEN</b> to architect, design, and deliver the official web platform and administrative CMS for <b>MITTAI BANDI</b> (GURMITRAA Technologies Pvt. Ltd.).<br/><br/>"
                   "From crafting the vibrant visual identity celebrating India's rich culinary traditions to engineering a resilient, high-performance, and secure cloud content infrastructure, our goal has been to provide a digital foundation that empowers your vision of bringing traditional sweets to every Indian household.<br/><br/>"
                   "We extend our deepest gratitude to the leadership and team at <b>GURMITRAA Technologies</b> for your trust, collaboration, and partnership throughout this journey. We look forward to seeing MITTAI BANDI flourish and scale to extraordinary heights.<br/><br/>"
                   "<b>Thank you for choosing ARANEA DEN as your digital engineering partner!</b><br/><br/>"
                   "<i>With warmest regards,<br/><b>Team ARANEA DEN</b><br/>Software Engineering &amp; Digital Innovation</i>", body_style)]
    ]
    t_thanks = Table(thanks_box, colWidths=[504])
    t_thanks.setStyle(TableStyle([
        ('BACKGROUND', (0,0), (-1,-1), colors.HexColor("#FFFDF9")),
        ('BOX', (0,0), (-1,-1), 1.5, PRIMARY),
        ('TOPPADDING', (0,0), (-1,-1), 12),
        ('BOTTOMPADDING', (0,0), (-1,-1), 12),
        ('LEFTPADDING', (0,0), (-1,-1), 16),
        ('RIGHTPADDING', (0,0), (-1,-1), 16),
    ]))
    story.append(t_thanks)

    # Build PDF with custom canvas
    doc.build(story, canvasmaker=NumberedCanvas)
    print(f"[PDF] Successfully compiled: {PDF_OUTPUT}")


def build_docx():
    doc = Document()
    
    # Set standard 0.75-inch margins
    sections = doc.sections
    for s in sections:
        s.top_margin = Inches(0.75)
        s.bottom_margin = Inches(0.75)
        s.left_margin = Inches(0.75)
        s.right_margin = Inches(0.75)

    def set_cell_background(cell, fill_hex):
        shading = parse_xml(f'<w:shd {nsdecls("w")} w:fill="{fill_hex}"/>')
        cell._tc.get_or_add_tcPr().append(shading)

    def format_row(row, fill_hex, is_header=False):
        for cell in row.cells:
            set_cell_background(cell, fill_hex)
            cell.paragraphs[0].paragraph_format.space_before = Pt(3)
            cell.paragraphs[0].paragraph_format.space_after = Pt(3)
            if is_header:
                for run in cell.paragraphs[0].runs:
                    run.font.bold = True
                    run.font.color.rgb = RGBColor(255, 255, 255)

    # Title & Metadata
    p_badge = doc.add_paragraph()
    r_badge = p_badge.add_run("MITTAI BANDI")
    r_badge.font.name = "Arial"
    r_badge.font.size = Pt(11)
    r_badge.font.bold = True
    r_badge.font.color.rgb = RGBColor(201, 157, 61) # Gold

    p_title = doc.add_paragraph()
    r_title = p_title.add_run("System Technical Architecture & Client Handover Documentation")
    r_title.font.name = "Arial"
    r_title.font.size = Pt(22)
    r_title.font.bold = True
    r_title.font.color.rgb = RGBColor(201, 0, 61) # Crimson

    p_sub = doc.add_paragraph()
    r_sub = p_sub.add_run("Comprehensive Technical Blueprint, Infrastructure, Security Specifications, CMS Operations Guide, and Handover Protocols for GURMITRAA Technologies Pvt. Ltd.")
    r_sub.font.name = "Arial"
    r_sub.font.size = Pt(10.5)
    r_sub.font.color.rgb = RGBColor(107, 114, 128)

    # Metadata Table
    meta_table = doc.add_table(rows=9, cols=2)
    meta_table.alignment = WD_TABLE_ALIGNMENT.CENTER
    meta_rows = [
        ("Project:", "MITTAI BANDI Web Portal & Administrative CMS"),
        ("Client Organization:", "GURMITRAA Technologies Pvt. Ltd., Rajahmundry, Andhra Pradesh"),
        ("Primary Domain:", "https://www.mittaibandi.com"),
        ("Administrative Portal:", "https://www.mittaibandi.com/admin/login.html"),
        ("GitHub Repository:", "https://github.com/mittaibandiportal-dev/MITTAI-BANDI-PORTAL (main)"),
        ("Cloud / Backend:", "Google Firebase (Auth & Realtime Database) + Vercel Global Edge CDN"),
        ("Documentation Version:", "v2.2.0 (Comprehensive Release)"),
        ("Date of Handover:", datetime.now().strftime("%B %d, %Y")),
        ("Engineering Partner:", "ARANEA DEN (Software Architecture & Digital Engineering)")
    ]
    for idx, (lbl, val) in enumerate(meta_rows):
        r = meta_table.rows[idx]
        c0, c1 = r.cells[0], r.cells[1]
        c0.width = Inches(2.0)
        c1.width = Inches(5.0)
        p0 = c0.paragraphs[0]
        p1 = c1.paragraphs[0]
        r0 = p0.add_run(lbl)
        r0.font.bold = True
        r0.font.size = Pt(9)
        r1 = p1.add_run(val)
        r1.font.size = Pt(9)
        set_cell_background(c0, "F9FAFB")
        set_cell_background(c1, "FFFFFF")

    doc.add_page_break()

    # Section 1
    h1 = doc.add_heading("1. Project Overview & Executive Summary", level=1)
    for r in h1.runs: r.font.color.rgb = RGBColor(201, 0, 61)
    p = doc.add_paragraph("MITTAI BANDI ('Traditional Taste. Digital Convenience.') is a premier digital confectionery marketplace engineered for GURMITRAA Technologies Pvt. Ltd., based in Rajahmundry, Andhra Pradesh, India. The platform bridges generational sweet makers and traditional confectioners with regional sweet lovers through a modern, mobile-first, and highly responsive web portal.")
    p.runs[0].font.size = Pt(9.5)
    
    doc.add_heading("Core Business Objectives & Features:", level=3)
    bullets = [
        ("Dual Audience Marketplace: ", "Provides dedicated customer-facing storefront showcases while providing vendor onboarding pathways for artisan sweet makers."),
        ("Modern Content Management: ", "Full CMS administrative control allowing administrators to modify banners, brand messaging, pricing notices, office details, and legal documents in real time without code deployment."),
        ("Dynamic Video Hero: ", "YouTube-backed, autoplaying, looping responsive hero system with separate 16:9 desktop video and 9:16 mobile YouTube Shorts integration, supported by automatic image fallback."),
        ("Statutory & Regulatory Compliance: ", "Full FSSAI licensing display (License #10125018000861), Corporate CIN (U72900AP2020PTC114398), Consumer Protection Act Grievance Redressal officer escalation matrix, and strict food safety advisory channels."),
        ("Multi-Device Optimization: ", "Engineered with sub-second loading speeds, zero render-blocking layout shifts, lazy-loaded visual assets, and full cross-browser reliability across desktop, iOS, and Android devices.")
    ]
    for b_title, b_desc in bullets:
        bp = doc.add_paragraph(style='List Bullet')
        r_bt = bp.add_run(b_title)
        r_bt.font.bold = True
        r_bt.font.size = Pt(9)
        r_bd = bp.add_run(b_desc)
        r_bd.font.size = Pt(9)

    # Section 2
    h2 = doc.add_heading("2. Technology Stack & Architectural Specifications", level=1)
    for r in h2.runs: r.font.color.rgb = RGBColor(201, 0, 61)
    doc.add_paragraph("The platform is engineered using a robust, decoupled JAMstack architecture delivering unmatched page rendering performance, near-zero hosting maintenance, enterprise-level security, and high uptime.")

    tech_table = doc.add_table(rows=8, cols=3)
    tech_table.alignment = WD_TABLE_ALIGNMENT.CENTER
    t_headers = ["Layer", "Technology / Library", "Purpose / Implementation Details"]
    for i, title in enumerate(t_headers):
        tech_table.rows[0].cells[i].paragraphs[0].add_run(title)
    format_row(tech_table.rows[0], "C9003D", is_header=True)

    tech_rows = [
        ("Frontend Core", "Semantic HTML5, CSS3 Variables, ES6+ Modular JS", "Zero-framework vanilla implementation ensuring lightweight payloads, rapid DOM rendering, and zero framework upgrade churn."),
        ("Typography & UI", "Google Fonts (Inter, Manrope), Lucide SVG Icons", "Premium luxury aesthetic with clear typography hierarchy and crisp vector iconography."),
        ("Authentication", "Firebase Authentication (v10 Compat)", "Email/Password authentication hardened with Custom Claims (admin: true) and email whitelist protection."),
        ("Database / CMS", "Firebase Realtime Database (RTDB)", "Sub-second JSON document store supporting dual live/draft environments, schema verification, and RESTful sync."),
        ("Client Optimization", "HTML5 Canvas Engine (MB_CLOUDINARY)", "In-browser image auto-compression, aspect ratio normalization, and WebP generation before database persistence."),
        ("Hosting & Routing", "Vercel Global Edge Network", "Global CDN hosting, automated GitHub CI/CD deployment, HTTP/2, automated SSL, and vercel.json clean URL routing."),
        ("Local Dev Harness", "Node.js serve + PowerShell", "Lightweight zero-build development environment running clean URL rewrites locally via serve.json.")
    ]
    for idx, (l, t, p) in enumerate(tech_rows, start=1):
        row = tech_table.rows[idx]
        row.cells[0].paragraphs[0].add_run(l).font.size = Pt(8.5)
        row.cells[1].paragraphs[0].add_run(t).font.size = Pt(8.5)
        row.cells[2].paragraphs[0].add_run(p).font.size = Pt(8.5)
        format_row(row, "FFFFFF" if idx % 2 == 0 else "F9FAFB")

    # Section 3
    doc.add_heading("3. Codebase Architecture & File Organization", level=1)
    doc.add_paragraph("The codebase is organized cleanly to separate public website routes, administrative modules, visual styles, and cloud integrations:")
    p_code = doc.add_paragraph()
    r_c = p_code.add_run(
        "Root Directory Structure:\n"
        "├── index.html, about.html, partner.html, contact.html\n"
        "├── privacy-policy.html, terms-of-service.html, cancellation-refund.html, api-policy.html, 404.html\n"
        "├── vercel.json, firebase.json, serve.json, database.rules.json\n"
        "├── admin/ (index.html, login.html, css/admin.css, js/admin-cms.js, js/admin-auth.js, js/login-page.js)\n"
        "├── assets/css/ (design-system.css, home.css, about.css, partner.css, contact.css)\n"
        "├── assets/js/ (cms-client.js, cms-default-data.js, cloudinary.js, firebase.js, main.js)\n"
        "└── tools/admin-claims/ (set-admin-claim.mjs Node.js script)"
    )
    r_c.font.name = "Courier New"
    r_c.font.size = Pt(8.5)

    doc.add_page_break()

    # Section 4
    doc.add_heading("4. Website Pages & Section-Wise Architecture", level=1)
    pages_list = [
        ("Home (/)", "Responsive YouTube Hero (Desktop 16:9 / Mobile 9:16 Shorts), Dual CTA buttons & dynamic fallback poster, Promotional banners carousel, 6 Sweets categories, Regional flavours spotlight, App download section."),
        ("About Us (/about)", "Brand origin narrative, Mission & Vision cards, Corporate Overview (#EAF4FA sky-blue card), Artisan sweet making commitment, Dual audience community spotlight."),
        ("Partner With Us (/partner)", "Sweet Maker / Vendor Onboarding (Android & iOS), Delivery Partner Network (Android Google Play), Interactive partner registration form, 3-step partnership journey."),
        ("Contact & Support (/contact)", "6 Dedicated support channel cards, Dual support panels, Food safety advisory, 4-stage complaint escalation matrix, Statutory Grievance Redressal officer profile, Registered office card with FSSAI License #10125018000861, Anti-fraud security notice."),
        ("Legal Documents", "/privacy-policy, /terms-of-service, /cancellation-refund, /api-policy: Statutory Indian IT & Consumer Protection Act compliance with global visibility switches."),
        ("404 Page (/404)", "Custom branded error page guiding users back to Home and Support.")
    ]
    for p_name, p_desc in pages_list:
        p = doc.add_paragraph(style='List Bullet')
        r_pn = p.add_run(f"{p_name}: ")
        r_pn.font.bold = True
        r_pn.font.size = Pt(9)
        r_pd = p.add_run(p_desc)
        r_pd.font.size = Pt(9)

    # Section 5
    doc.add_heading("5. CMS Admin Dashboard & Administrative Capabilities", level=1)
    doc.add_paragraph("The MITTAI BANDI Administrative Dashboard is accessible at https://www.mittaibandi.com/admin/login.html. It provides non-technical administrators with an intuitive SaaS workspace to update portal content in real time. The dashboard contains 17 specialized modules across 4 clusters:")
    cms_clusters = [
        ("1. Core & Content", "Dashboard Overview, Hero Management (separate Desktop/Mobile YouTube fields), Banner Management, Image Library (Canvas WebP compression)."),
        ("2. Page Modules", "Page Management (SEO & Slugs), About Us Management, Partner Management, Contact Management (all 8 sections & FSSAI license)."),
        ("3. Footer, Legal & Apps", "Footer Management, Legal Documents (Visual & HTML Source editor), App Links Management (Play Store & App Store links)."),
        ("4. Brand & Settings", "Header & Nav, Branding (Logo & Favicon), Preloader Screen, Theme & Styling, Form Enquiries Viewer, Activity Audit Logs, Settings.")
    ]
    for c_name, c_desc in cms_clusters:
        p = doc.add_paragraph(style='List Bullet')
        r_cn = p.add_run(f"{c_name}: ")
        r_cn.font.bold = True
        r_cn.font.size = Pt(9)
        r_cd = p.add_run(c_desc)
        r_cd.font.size = Pt(9)

    # Section 6
    doc.add_heading("6. Administrator Credentials & Security Protocols", level=1)
    doc.add_paragraph("Administrative access to the MITTAI BANDI CMS is protected by an enterprise-grade authentication model powered by Firebase Authentication. There are no hardcoded credentials, no plain-text passwords, and no insecure local credentials in the code.")
    
    cred_table = doc.add_table(rows=1, cols=1)
    cred_table.alignment = WD_TABLE_ALIGNMENT.CENTER
    c_cell = cred_table.rows[0].cells[0]
    set_cell_background(c_cell, "F0FDF4")
    cp = c_cell.paragraphs[0]
    cp.add_run("AUTHENTICATED PRIMARY ADMINISTRATOR ACCOUNT\n").font.bold = True
    cp.add_run("• Designated Admin Email: mittaibandiportal@gmail.com\n"
               "• Firebase Project ID: mittaibandi-portal\n"
               "• Administrative Portal URL: https://www.mittaibandi.com/admin/login.html\n"
               "• Authorization Model: Firebase Custom Claim (admin: true) enforced at database security rules.\n"
               "• Password Security: Managed directly by Firebase Auth. Never transmitted or logged in plain-text.")

    doc.add_heading("Password Reset Procedure:", level=3)
    p_reset = doc.add_paragraph()
    p_reset.add_run("1. Open https://www.mittaibandi.com/admin/login.html\n"
                    "2. Click 'Forgot Password?' above the password input.\n"
                    "3. Enter mittaibandiportal@gmail.com and click 'Send Password Reset Link'.\n"
                    "4. Open the link sent to your email inbox and enter your new password.\n"
                    "5. Return to the Admin Login page and sign in with your updated credentials.")

    # Section 7
    doc.add_heading("7. Media, Image & Video Management Architecture", level=1)
    doc.add_paragraph("Actual Implementation Status: The portal implements a high-performance, client-side HTML5 Canvas compression engine (MB_CLOUDINARY in assets/js/cloudinary.js) combined with direct Firebase RTDB persistence. This eliminates third-party image upload failures (such as Cloudinary 400 preset errors) and ensures instant, reliable image updates without incurring recurring SaaS fees.")
    doc.add_paragraph("Recommended Dimensions: Desktop Hero Poster: 1920x1080 (16:9), Mobile Hero Poster: 1080x1920 (9:16), Banners: 1400x600, Product Cards: 800x800 (1:1), Logos: 512x512.")
    doc.add_paragraph("YouTube Playback Rules: Supports watch, youtu.be, and Shorts URLs. If YouTube fails or is blocked, the frontend automatically displays the configured fallback poster image.")

    doc.add_page_break()

    # Section 8
    doc.add_heading("8. Database Architecture & Security Rules", level=1)
    doc.add_paragraph("The platform uses Firebase Realtime Database (RTDB) in Asia-Southeast1. The database employs a dual-stage publishing model ensuring content safety:")
    doc.add_paragraph("• /cms/live: Publicly readable live website content (synced to visitors).\n"
                      "• /cms/draft: Working staging environment (read/write by admin only).\n"
                      "• /cms/media: Admin image library metadata catalog & data URLs.\n"
                      "• /cms/history: Activity audit log tracking every save, publish, and login event.\n"
                      "• /contact_submissions & /partner_registrations: Customer and vendor form submissions.")

    # Section 9 & 10
    doc.add_heading("9. Hosting, Deployment & Domain Configuration", level=1)
    doc.add_paragraph("• Hosting Provider: Vercel Global Edge Network\n"
                      "• Live Production Domain: https://www.mittaibandi.com (Apex mittaibandi.com redirects to www)\n"
                      "• SSL / TLS: Automated Let's Encrypt TLS 1.3\n"
                      "• Clean URLs: Configured via vercel.json and serve.json (removes .html extensions)\n"
                      "• CI/CD: Automated deployments on push to GitHub main branch")

    doc.add_heading("10. GitHub Version Control & Rollback Protocols", level=1)
    doc.add_paragraph("Repository: https://github.com/mittaibandiportal-dev/MITTAI-BANDI-PORTAL (Branch: main)")
    p_git = doc.add_paragraph()
    p_git.add_run("Standard Git Workflow:\n"
                  "git pull origin main\n"
                  "git add .\n"
                  "git commit -m \"Update message\"\n"
                  "git push origin main")
    p_git.runs[0].font.name = "Courier New"

    # Section 11 & 12
    doc.add_heading("11. Content Publishing Lifecycle & Quality Assurance", level=1)
    doc.add_paragraph("Workflow: Edit in Admin CMS → Save Draft (/cms/draft) → Live Preview (Desktop/Tablet/Mobile) → Publish Changes (/cms/live) → Live Verification on www.mittaibandi.com.")

    doc.add_heading("12. Customer Inquiries & Partner Registration Architecture", level=1)
    doc.add_paragraph("Inquiries submitted through the Contact and Partner forms are persisted in Firebase RTDB nodes contact_submissions and partner_registrations, and viewed inside Admin CMS under Form Enquiries.")

    # Section 13 & 14
    doc.add_heading("13. Operational Maintenance & Troubleshooting Guide", level=1)
    doc.add_paragraph("• Admin Panel Blank: Open /admin/login.html directly. Clear browser session storage.\n"
                      "• Video Fallback Shown: Check YouTube video embedding permissions; ensure video is Public or Unlisted.\n"
                      "• 404 on Refresh: Verify vercel.json cleanUrls is active on Vercel deployment.")

    doc.add_heading("14. Service Ownership & Asset Handover Matrix", level=1)
    doc.add_paragraph("• Domain: mittaibandi.com (Client DNS pointed to Vercel)\n"
                      "• Hosting: Vercel Project mittai-bandi-portal\n"
                      "• Database & Auth: Google Firebase Project mittaibandi-portal\n"
                      "• Source Code: GitHub Repository mittaibandiportal-dev/MITTAI-BANDI-PORTAL\n"
                      "• Primary Admin: mittaibandiportal@gmail.com")

    # Closing Thanks Note
    doc.add_page_break()
    h_thx = doc.add_heading("A Sincere Note of Appreciation from ARANEA DEN", level=1)
    for r in h_thx.runs: r.font.color.rgb = RGBColor(201, 0, 61)
    
    t_box = doc.add_table(rows=1, cols=1)
    t_box.alignment = WD_TABLE_ALIGNMENT.CENTER
    c_thx = t_box.rows[0].cells[0]
    set_cell_background(c_thx, "FFFDF9")
    tp = c_thx.paragraphs[0]
    tp.add_run(
        "It has been an absolute honor and pleasure for the entire team at ARANEA DEN to architect, design, and deliver the official web platform and administrative CMS for MITTAI BANDI (GURMITRAA Technologies Pvt. Ltd.).\n\n"
        "From crafting the vibrant visual identity celebrating India's rich culinary traditions to engineering a resilient, high-performance, and secure cloud content infrastructure, our goal has been to provide a digital foundation that empowers your vision of bringing traditional sweets to every Indian household.\n\n"
        "We extend our deepest gratitude to the leadership and team at GURMITRAA Technologies for your trust, collaboration, and partnership throughout this journey. We look forward to seeing MITTAI BANDI flourish and scale to extraordinary heights.\n\n"
        "Thank you for choosing ARANEA DEN as your digital engineering partner!\n\n"
        "With warmest regards,\n"
        "Team ARANEA DEN\n"
        "Software Engineering & Digital Innovation"
    )

    doc.save(DOCX_OUTPUT)
    print(f"[DOCX] Successfully compiled: {DOCX_OUTPUT}")


if __name__ == "__main__":
    print("Compiling Handover Documentation...")
    build_pdf()
    build_docx()
    print("All deliverables generated successfully!")
