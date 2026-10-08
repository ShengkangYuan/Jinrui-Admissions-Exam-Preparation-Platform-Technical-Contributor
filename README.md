# Jinrui Admissions & Exam Preparation Platform

A school-based digital platform supporting exam and admission preparation, alongside IELTS learning, interview practice, student analytics, and university-planning workflows. The platform provides dedicated student, teacher, and administrator interfaces and can run locally with SQLite or be deployed to the cloud. 

## Project Context
This platform was developed under the guidance of the school's **College Counselor and Head of Senior School**. I was a technical contributor rather than the sole developer.

My contribution focused on AI-assisted content processing, question-bank quality assurance, debugging, system maintenance, and updates.

## My Contribution

### AI-Assisted Question Recognition
I used vision models to help convert PDF and image-based examination materials into structured digital questions, including mathematical expressions and answer data. The pipeline combines visual recognition with normalization and quality checks before content enters the teacher-review stage. 

### Question-Bank Quality Assurance
I helped inspect and maintain imported questions by identifying issues such as missing or merged questions, inconsistent formatting, incorrect answer alignment, and other data-quality problems. The system includes automated checks for incomplete questions, suspiciously merged items, and answer inconsistencies. 

### Debugging & Maintenance
I assisted with diagnosing software problems, fixing bugs with AI-assisted development tools, supporting security and access-control maintenance, and helping keep the platform updated and reliable for continued school use.

## AI with Human Oversight
A key principle of the platform is that AI is used for **perception and generation**, while deterministic rules and human review remain responsible for critical decisions. AI-generated or AI-modified content is placed into a review workflow rather than being published directly to students. 
This experience taught me that effective AI engineering is not simply about generating outputs. It requires **verification, controlled deployment, error handling, and human judgment**.

## Technical Stack
Next.js · React · TypeScript · Node.js · Express · Prisma · SQLite/PostgreSQL · OpenAI-compatible LLM APIs · Vision Models