# Workflow

In the following terms of agile software engineering are used to describe the agentic systems to solve specific problems. However, there are also humans involved in the workflow stated as "God". God means that these actions are out of the power of the agentic system and are beyond all doubt. 

## Customer Product Requirements Document

The customer product requirements document (C-PRD) is a document, which describes the customer's needs in a semi-technical way. The document focuses on the problem to be solved for the customer by the product.

### C-PRD Workflows

1. *God* adds the **C-PRD** into the `spec/prd` folder. 
2. The **changes in the document** are identified by the *prd-tp-issue* workflow 
3. The **effected issues** are identified by the *Product Manager* 
   - Open issues are updated accordingly
   - Closed issues are used to create new issues for the change (linked to original issue)
4. **New issues** are created by the *Product Manager*

#### Creating and updating issues

- Define the category of the issue (Technical Features, Non-technical Features, Enabler Features, Blockers)
- Create labels for the issue (TODO: label set)
- Mark as blocked by, if needed