import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync, readdirSync } from 'fs';
import { join } from 'path';

const SKILLS_DIR = join(__dirname, '..', '..', 'skills');

const EXPECTED_SKILLS = [
  'analyze-cbo-obj', 'analyze-code', 'analyze-symptom', 'ask-consultant',
  'compare-programs', 'create-object', 'create-program',
  'mcp-setup', 'program-to-spec', 'sap-doctor',
  'sap-option', 'setup', 'trust-session',
];

describe('Skills Validation', () => {
  it(`all ${EXPECTED_SKILLS.length} skill directories exist`, () => {
    for (const skill of EXPECTED_SKILLS) {
      const dir = join(SKILLS_DIR, skill);
      expect(existsSync(dir), `Missing skill directory: ${skill}`).toBe(true);
    }
  });

  for (const skill of EXPECTED_SKILLS) {
    describe(`sp4sap:${skill}`, () => {
      const skillFile = join(SKILLS_DIR, skill, 'SKILL.md');

      it('SKILL.md exists', () => {
        expect(existsSync(skillFile)).toBe(true);
      });

      it('has valid frontmatter', () => {
        if (!existsSync(skillFile)) return;
        const content = readFileSync(skillFile, 'utf-8');
        const frontmatterMatch = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
        expect(frontmatterMatch, 'Missing frontmatter delimiters').toBeTruthy();
        const fm = frontmatterMatch![1];
        expect(fm).toContain('name:');
        expect(fm).toContain('description:');
      });

      it('has sp4sap: prefix in name', () => {
        if (!existsSync(skillFile)) return;
        const content = readFileSync(skillFile, 'utf-8');
        const nameMatch = content.match(/name:\s*sp4sap:/);
        expect(nameMatch, 'Skill name must have sp4sap: prefix').toBeTruthy();
      });
    });
  }
});
