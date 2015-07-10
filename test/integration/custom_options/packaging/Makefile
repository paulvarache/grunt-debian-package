all: # nothing to build

install:
	mkdir -p "$(DESTDIR)/var/www/tasks" && cp -ap -P "${current_dir}/tasks/debian_package.js" "$(DESTDIR)/var/www/tasks/debian_package.js"
	mkdir -p "$(DESTDIR)/var/www/tasks" && cp -ap -P "${current_dir}/tasks/options.js" "$(DESTDIR)/var/www/tasks/options.js"
	mkdir -p "$(DESTDIR)/var/www" && cp -ap -P "${current_dir}/test/integration/custom_options/packaging/debian/changelog" "$(DESTDIR)/var/www/"
	mkdir -p "$(DESTDIR)/var/www" && cp -ap -P "${current_dir}/test/integration/custom_options/packaging/debian/control" "$(DESTDIR)/var/www/"

