ALTER TABLE `user_preferences` ADD `gemini_api_key` text;--> statement-breakpoint
ALTER TABLE `user_preferences` ADD `custom_tts_prompt` text;--> statement-breakpoint
ALTER TABLE `user_preferences` ADD `abbreviations` text DEFAULT '{}';--> statement-breakpoint
ALTER TABLE `user_preferences` ADD `pronunciations` text DEFAULT '{}';