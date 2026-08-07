import sys
import os

with open("biblical_scholar_worker.py", "r") as f:
    code = f.read()
    
print("Has CHAPTER_TITLE generation:", "CHAPTER_TITLE GENERATION:" in code)
