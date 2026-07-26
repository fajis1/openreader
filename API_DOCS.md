# OpenReader Headless REST API Documentation

OpenReader provides a REST API that allows external scripts, desktop tools (such as Logos Bible Software export automation), and third-party applications to upload documents directly into OpenReader for processing and audiobook generation.

---

## 1. Authentication

All requests to the OpenReader API require an `Authorization` HTTP header with a Bearer token:

```http
Authorization: Bearer OR_YOUR_GENERATED_API_KEY
```

### Generating an API Key
1. Open the OpenReader Web UI in your browser.
2. Click **Settings** (or **🔑 API & Integrations** in the bottom action bar).
3. Select **API Keys** from the sidebar.
4. Click **Create API Key**, enter a key description (e.g. `Logos Export Pipeline`), and click **Generate**.
5. Copy your raw API key (starts with `or_live_...`). Save it immediately in your script's `.env` or configuration file; for security reasons, OpenReader stores only an encrypted hash and will not show the key again.

---

## 2. Document Upload Endpoint

### Endpoint Signature
* **URL:** `POST /api/v1/upload`
* **Content-Type:** `multipart/form-data`

### Form Fields

| Field Name | Type | Required | Description |
| :--- | :--- | :--- | :--- |
| `file` | File Binary | **Yes** | The document binary file (`.pdf`, `.epub`, `.docx`, `.html`, `.txt`). |
| `title` | Text | No | Document title. Defaults to filename if omitted. |
| `profile` | Text | No | Processing profile for workers (e.g., `Biblical Scholarship 3.6` or `Default Profile`). |

### Response (`200 OK`)

```json
{
  "success": true,
  "documentId": "4a82b9e...",
  "title": "Genesis Chapter 1 - Logos Export",
  "type": "pdf",
  "size": 1048576,
  "status": "queued",
  "message": "Document successfully uploaded and queued for OpenReader processing."
}
```

---

## 3. Code Examples

### cURL
```bash
curl -X POST https://reader.seekins.info/api/v1/upload \
  -H "Authorization: Bearer or_live_abcdef1234567890..." \
  -F "file=@/path/to/Genesis_Study.pdf" \
  -F "title=Genesis Chapter 1" \
  -F "profile=Biblical Scholarship 3.6"
```

### Python
```python
import requests

url = "https://reader.seekins.info/api/v1/upload"
api_key = "or_live_abcdef1234567890..."

headers = {
    "Authorization": f"Bearer {api_key}"
}

files = {
    "file": ("Genesis_Study.pdf", open("/path/to/Genesis_Study.pdf", "rb"), "application/pdf")
}

data = {
    "title": "Genesis Chapter 1",
    "profile": "Biblical Scholarship 3.6"
}

response = requests.post(url, headers=headers, files=files, data=data)
print(response.json())
```

### Windows PowerShell
```powershell
$Uri = "https://reader.seekins.info/api/v1/upload"
$ApiKey = "or_live_abcdef1234567890..."
$FilePath = "C:\Exports\Genesis_Study.pdf"

$Form = @{
    file = Get-Item -Path $FilePath
    title = "Genesis Chapter 1"
}

$Headers = @{
    Authorization = "Bearer $ApiKey"
}

$Response = Invoke-RestMethod -Uri $Uri -Method Post -Headers $Headers -Form $Form
$Response | ConvertTo-Json
```
