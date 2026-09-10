# Qoyod MCP — المرجع الكامل: ماذا يقدر يسوي، وماذا لا يقدر

الإصدار 1.1.0 (يدعم أكثر من شركة). كل المعرّفات والأسماء والمبالغ في الأمثلة **افتراضية للتوضيح فقط**.

## 1) التغطية مقابل المصدر الرسمي

مجموعة Postman الرسمية خلف `apidoc.qoyod.com` فيها **76 طلب** موزعة على **19 مورد**، وكلها مغطاة في الـ MCP:

| المورد في المصدر | الطلبات في المصدر | أداة الـ MCP | الإجراءات |
|---|---|---|---|
| Accounts | 3 | `qoyod_accounts` | list, get, create |
| Products | 4 | `qoyod_products` | list, get, create, update |
| Inventories + Inventory Management | 4 + 2 | `qoyod_inventories` | list, get, create, update, adjust, transfer |
| Product Categories | 4 | `qoyod_product_categories` | list, get, create, update |
| Product Units | 3 | `qoyod_product_units` | list, get, create |
| Vendors | 4 | `qoyod_vendors` | list, get, create, update |
| Purchase Orders | 3 | `qoyod_purchase_orders` | list, get, create |
| Bills (+ allocation) | 4 + 1 | `qoyod_bills` | list, get, create, delete, allocate |
| Bill Payments | 3 | `qoyod_bill_payments` | list, get, create |
| Simple Bills (+ allocation) | 5 + 1 | `qoyod_simple_bills` | list, get, create, update, delete, allocate |
| Simple Bill Payments | 3 | `qoyod_simple_bill_payments` | list, get, create |
| Debit Notes | 4 | `qoyod_debit_notes` | list, get, create, delete |
| Customers | 4 | `qoyod_customers` | list, get, create, update |
| Quotes | 3 | `qoyod_quotes` | list, get, create |
| Invoices (+ pdf + allocation) | 5 + 1 | `qoyod_invoices` | list, get, create, delete, allocate, pdf |
| Invoice Payments | 3 | `qoyod_invoice_payments` | list, get, create |
| Credit Notes | 4 | `qoyod_credit_notes` | list, get, create, delete |
| Receipts (+ allocation) | 5 | `qoyod_receipts` | list, get, create, delete, allocate |
| Journal Entries | 3 | `qoyod_journal_entries` | list, get, create |
| **المجموع** | **76** | **19 أداة** | |

## 2) قدرات عامة (تنطبق على كل الأدوات)

- **أكثر من شركة**: كل شركة في قيود لها مفتاح API خاص بها. مع شركتين تظهر معلمة `company` في كل أداة. القراءة بدون تحديد الشركة تذهب للشركة الأولى، وأي **كتابة بدون تحديد الشركة تُرفض**.
- **الترقيم**: `page` و `per_page`. قيود يحترمهما في بعض الموارد ويتجاهلهما في أخرى (مثل الحسابات والموردين والقيود).
- **الفلترة (Ransack)**: مثل `issue_date_gteq` و `status_eq` و `contact_id_eq` و `code_start` و `id_in`. بعض الفلاتر يتجاهلها قيود، وعندها يجلب المساعد القائمة ويفلترها بنفسه.
- **الترتيب**: `sort` مثل `"issue_date desc"` أو `"code desc"`.
- **القوائم الفارغة** ترجع `[]` بدل خطأ 404 الذي يرسله قيود.
- **الأخطاء** تصل نصياً مع رقم الحالة ورسالة قيود، مثل: `422 {"errors":["this contact <id> is not active"]}`.

## 3) الأدوات الـ 19 مع أمثلة توضيحية

### 3.1 `qoyod_accounts` — دليل الحسابات
- **قراءة**: `list` لكل الحسابات، و `get id=<id>` لحساب واحد، وفلتر `q={"code_start":"5"}` مع `sort="code desc"` لحسابات المصروفات.
- **كتابة (مثال)**: `create data={"name_en":"Bank - Example","name_ar":"بنك تجريبي","code":"110299","type":"Bank","receive_payments":"true"}`.

### 3.2 `qoyod_products` — المنتجات والخدمات
- **قراءة**: `list`، و `get id=<id>` (يتضمن الضريبة وحالة التتبع المخزوني والمخزون لكل مستودع).
- **كتابة (مثال)**: `create data={"sku":"SVC-100","name_ar":"خدمة استشارية","name_en":"Consulting service","product_unit_type_id":<unit_id>,"category_id":<category_id>,"tax_id":1,"type":"Service","sale_item":1,"selling_price":1500,"sales_account_id":<sales_account_id>}` و `update id=<id> data={"barcode":"123456"}` (لا يمكن تعديل حساب المبيعات أو الوحدة لمنتج دخل في فواتير).

### 3.3 `qoyod_inventories` — المستودعات وحركات المخزون
- **قراءة**: `list`، و `get id=<id>`.
- **كتابة (مثال)**: `create data={"name":"Branch 2","ar_name":"فرع 2","account_id":<inventory_account_id>}`، و `adjust data={"inventory_id":<id>,"revenue_account_id":<id>,"expense_account_id":<id>,"date":"2026-01-15","description":"جرد","line_items":[{"product_id":<id>,"actual_quantity":25,"rate":120}]}` (الكمية هي الرصيد الجديد الكلي وليست الفرق)، و `transfer data={"from_location":<id>,"to_location":<id>,"date":"2026-01-15","description":"نقل","line_items":[{"product_id":<id>,"quantity":5}]}`.

### 3.4 `qoyod_product_categories` — تصنيفات المنتجات
- **قراءة**: `list`، و `get id=<id>`.
- **كتابة (مثال)**: `create data={"name":"خدمات","parent_id":<id>}` و `update id=<id> data={"description":"وصف"}`.

### 3.5 `qoyod_product_units` — وحدات القياس
- **قراءة**: `list`، و `get id=<id>`.
- **كتابة (مثال)**: `create data={"unit_name":"ساعة","unit_representation":"س","kind":3}`.

### 3.6 `qoyod_vendors` — الموردون
- **قراءة**: `list`، و `get id=<id>`.
- **كتابة (مثال)**: `create data={"name":"مورد تجريبي","tax_number":"3xxxxxxxxxxxxx3","phone_number":"05xxxxxxxx"}` و `update id=<id> data={"email":"info@example.com"}`.

### 3.7 `qoyod_purchase_orders` — أوامر الشراء
- **قراءة**: `list`، و `get id=<id>`.
- **كتابة (مثال)**: `create data={"contact_id":<vendor_id>,"issue_date":"2026-01-15","expiry_date":"2026-01-31","status":"Draft","inventory_id":<id>,"line_items":[{"product_id":<id>,"quantity":2,"unit_price":500,"tax_percent":15}]}`.

### 3.8 `qoyod_bills` — فواتير المشتريات
- **قراءة**: `list`، و `get id=<id>`، وفلتر `q={"issue_date_gteq":"2026-01-01"}`.
- **كتابة (مثال)**: `create data={"contact_id":<vendor_id>,"status":"Draft","issue_date":"2026-01-15","due_date":"2026-01-31","inventory_id":<id>,"line_items":[{"product_id":<id>,"quantity":1,"unit_price":1000,"tax_percent":15}]}`، و `delete id=<id>`، و `allocate id=<bill_id> data={"source_type":"Receipt","source_id":<receipt_id>,"amount":600,"date":"2026-01-15"}`.

### 3.9 `qoyod_bill_payments` — مدفوعات فواتير المشتريات
- **قراءة**: `list`، و `get id=<id>` (قد تكون المدفوعات مسجلة كسندات صرف في `qoyod_receipts`).
- **كتابة (مثال)**: `create data={"reference":"BP-1","bill_id":<bill_id>,"account_id":<bank_account_id>,"date":"2026-01-15","amount":600}`.

### 3.10 `qoyod_simple_bills` — الفواتير المبسطة (مصروفات بدون منتجات)
- **قراءة**: `list`، و `get id=<id>`.
- **كتابة (مثال)**: `create data={"contact_id":<vendor_id>,"status":"Draft","issue_date":"2026-01-15","inventory_id":<id>,"simple_bill_items_attributes":[{"expense_category_id":<expense_account_id>,"total_amount":300,"tax_id":1,"description":"إيجار"}]}`، و `update id=<id> data={"issue_date":"2026-01-16"}`، و `delete id=<id>`.

### 3.11 `qoyod_simple_bill_payments` — مدفوعات الفواتير المبسطة
- **قراءة**: `list`، و `get id=<id>`.
- **كتابة (مثال)**: `create data={"reference":"SBP-1","simple_bill_id":<id>,"account_id":<cash_account_id>,"date":"2026-01-15","amount":300}`.

### 3.12 `qoyod_debit_notes` — إشعارات المدين (مرتجعات المشتريات)
- **قراءة**: `list`، و `get id=<id>`.
- **كتابة (مثال)**: `create data={"contact_id":<vendor_id>,"issue_date":"2026-01-15","status":"Draft","inventory_id":<id>,"line_items":[{"product_id":<id>,"quantity":1,"unit_price":500,"tax_percent":15}]}` و `delete id=<id>`.

### 3.13 `qoyod_customers` — العملاء
- **قراءة**: `list`، و `get id=<id>` (يرجع العناوين وبيانات التواصل).
- **كتابة (مثال)**: `create data={"name":"عميل تجريبي","tax_number":"3xxxxxxxxxxxxx3","phone_number":"05xxxxxxxx","billing_address":{"billing_city":"الرياض","billing_country":"Saudi Arabia"}}` و `update id=<id> data={"email":"client@example.com"}`.

### 3.14 `qoyod_quotes` — عروض الأسعار
- **قراءة**: `list`، و `get id=<id>`.
- **كتابة (مثال)**: `create data={"contact_id":<customer_id>,"quotation_number":"Q-2026-001","issue_date":"2026-01-15","expiry_date":"2026-01-31","status":"Draft","inventory_id":<id>,"line_items":[{"product_id":<id>,"quantity":1,"unit_price":5000,"tax_percent":15}]}`.

### 3.15 `qoyod_invoices` — فواتير المبيعات
- **قراءة**: `list`، و `get id=<id>` (يتضمن `qrcode_string` و `zatca_details` و `payments`)، وفلتر `q={"status_eq":"Approved"}` أو `q={"contact_id_eq":<customer_id>}`. و `pdf id=<id>` يرجع رابط PDF مؤقت.
- **كتابة (مثال)**: `create data={"contact_id":<customer_id>,"status":"Draft","issue_date":"2026-01-15","due_date":"2026-01-31","inventory_id":<id>,"line_items":[{"product_id":<id>,"quantity":1,"unit_price":500,"tax_percent":15}]}`، و `allocate id=<invoice_id> data={"source_type":"Receipt","source_id":<receipt_id>,"amount":575,"date":"2026-01-15"}`، و `delete id=<draft_id>`.

### 3.16 `qoyod_invoice_payments` — مدفوعات فواتير المبيعات
- **قراءة**: `list`، و `get id=<id>` (قد تكون المقبوضات مسجلة كسندات قبض في `qoyod_receipts`).
- **كتابة (مثال)**: `create data={"reference":"IP-1","invoice_id":<invoice_id>,"account_id":<bank_account_id>,"date":"2026-01-15","amount":575}`.

### 3.17 `qoyod_credit_notes` — إشعارات الدائن (مرتجعات المبيعات)
- **قراءة**: `list`، و `get id=<id>` (يتضمن `qrcode_string` و `zatca_details`).
- **كتابة (مثال)**: `create data={"contact_id":<customer_id>,"issue_date":"2026-01-15","status":"Draft","inventory_id":<id>,"line_items":[{"product_id":<id>,"quantity":1,"unit_price":2000,"tax_percent":15}]}` و `delete id=<draft_id>`.

### 3.18 `qoyod_receipts` — سندات القبض والصرف
- **قراءة**: `list`، و `get id=<id>`، وفلتر `q={"date_gteq":"2026-01-01"}`.
- **كتابة (مثال)**: `create data={"contact_id":<vendor_id>,"reference":"PYT-900","kind":"paid","account_id":<bank_account_id>,"amount":600,"date":"2026-01-15","description":"سداد فاتورة"}`، و `allocate id=<receipt_id> data={"allocatee_type":"Bill","allocatee_id":<bill_id>,"amount":600}`، و `delete id=<id>`.

### 3.19 `qoyod_journal_entries` — القيود اليومية
- **قراءة**: `list`، و `get id=<id>`.
- **كتابة (مثال)**: `create data={"description":"تسوية","date":"2026-01-15","debit_amounts":[{"account_id":<id>,"amount":500}],"credit_amounts":[{"account_id":<id>,"amount":500}]}` (المدين يساوي الدائن، و `contact_id` يُسمح به فقط مع حساب الذمم المدينة للعملاء أو الذمم الدائنة للموردين).

## 4) خارج النطاق: ما لا يوفره API قيود أصلاً

**لا تعديل بعد الإنشاء** (لا يوجد endpoint تعديل) لـ: فواتير المبيعات، فواتير المشتريات، أوامر الشراء، عروض الأسعار، إشعارات الدائن والمدين، السندات، كل أنواع المدفوعات، القيود، الحسابات، الوحدات. يعني:
- **لا اعتماد مسودة** (Draft إلى Approved) عبر API، وتُعتمد من داخل قيود.
- لا تغيير تاريخ أو بنود أو عميل فاتورة قائمة (الاستثناء الوحيد: الفواتير المبسطة تقبل التعديل).

**لا حذف** لـ: العملاء، الموردين، المنتجات، التصنيفات، الحسابات، الوحدات، المستودعات، أوامر الشراء، عروض الأسعار، القيود، المدفوعات، تسويات وتحويلات المخزون. (الحذف متاح فقط لـ: فواتير المبيعات، فواتير المشتريات، الفواتير المبسطة، إشعارات الدائن والمدين، السندات.)

**لا قراءة** لتسويات وتحويلات المخزون (إنشاء فقط).

**لا تقارير محاسبية** (ميزان مراجعة، قائمة دخل، ميزانية عمومية، الإقرار الضريبي، أعمار الذمم، دفتر الأستاذ، كشف حساب عميل). يمكن للمساعد *تقريب* بعضها بتجميع القيود والفواتير، لكنها ليست تقارير قيود الرسمية.

**كيانات بلا endpoint موثّق**: الضرائب (المعرفات الافتراضية 1=15%، 2=0%، 3=معفى)، فئات المصروفات، المشاريع، مراكز التكلفة، العمولات، تعريف الحقول المخصصة، طرق الدفع، العملات، الموظفون والرواتب، الأصول الثابتة، نقاط البيع، المرفقات، البنوك والتسوية البنكية، العقود، الفروع كإعدادات، القوالب.

**الفوترة الإلكترونية (زاتكا)**: لا إرسال ولا تقرير ولا حالة قبول أو رفض. المتاح قراءة فقط: `qrcode_string` و `zatca_details` داخل الفاتورة وإشعار الدائن.

**أخرى**: لا إرسال فاتورة بالبريد أو واتساب، لا تحويل عرض سعر إلى فاتورة أو أمر شراء إلى فاتورة مشتريات، لا تراجع عن حذف، لا webhooks، لا بيئة تجريبية (كل شيء على البيانات الحقيقية).

## 5) أشياء يسويها المستخدم بنفسه داخل قيود

1. **توليد مفتاح API لكل شركة** (الإعدادات ثم الإعدادات العامة ثم مفتاح API ثم حفظ) وإدخاله في إعدادات الامتداد أو ملف `.env`.
2. **اعتماد المسودات** (فواتير، فواتير مشتريات، إشعارات، أوامر شراء، عروض).
3. **حذف السجلات غير القابلة للحذف** عبر API.
4. **إنشاء أو تعديل**: الضرائب المخصصة، فئات المصروفات، المشاريع، مراكز التكلفة، الحقول المخصصة، طرق الدفع، العملات، المستخدمين والصلاحيات.
5. **تفعيل إعداد "خصم إجمالي" (Total CD Discount)** إن أردت خصماً على مستوى المستند.
6. **إرسال الفواتير للعملاء** وتقارير زاتكا الرسمية والتقارير المالية المعتمدة.
