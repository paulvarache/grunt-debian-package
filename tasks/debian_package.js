var DEBUILD_CMD = 'debuild --no-tgz-check -sa -us -uc --lintian-opts --suppress-tags tar-errors-from-data,tar-errors-from-control,dir-or-file-in-var-www';

var fs = require('fs'),
    path = require('path'),
    spawn = require('child_process').spawn,
    dateFormat = require('dateformat');

module.exports = function (grunt) {

    'use strict';

    var _validateOptions = require('./options.js')._validate(grunt);

    grunt.registerMultiTask('deb_package', 'Create debian package from grunt build', function () {
            // tell Grunt this task is asynchronous.
            var done = this.async();

            // Merge task-specific and/or target-specific options with these defaults.
            var pkg = grunt.file.readJSON('package.json'),
                options = this.options({
                    maintainer: process.env.DEBFULLNAME && process.env.DEBEMAIL && {
                        name: process.env.DEBFULLNAME,
                        email: process.env.DEBEMAIL
                    } || pkg.author && pkg.author.name && pkg.author.email && pkg.author,
                    name: pkg.name,
                    prefix: '',
                    postfix: '',
                    short_description: (pkg.description && pkg.description.split(/\r\n|\r|\n/g)[0]) || '',
                    long_description: (pkg.description && pkg.description.split(/\r\n|\r|\n/g).splice(1).join(' ')) || '',
                    version: pkg.version,
                    build_number: process.env.BUILD_NUMBER || process.env.DRONE_BUILD_NUMBER || process.env.TRAVIS_BUILD_NUMBER || '1',
                    working_directory: 'tmp/',
                    packaging_directory_name: 'packaging',
                    target_architecture: 'all',
                    category: 'misc',
                    links: [],
                    directories: [],
                    custom_template: '../packaging/'
                }),
                now = dateFormat(new Date(), 'ddd, d mmm yyyy h:MM:ss +0000'),
                temp_directory = options.working_directory + options.packaging_directory_name,
                controlDirectory = temp_directory + '/debian';

            if (!_validateOptions(options, options.quiet)) {
                return done(false);
            }

            options.custom_template = path.join(options.custom_template, '**/*');
            options.date = now;

            if (options.dependencies) {
                options.dependencies = ', ' + options.dependencies;
            }

            // set environment variables if they are not already set
            process.env.DEBFULLNAME = options.maintainer.name;
            process.env.DEBEMAIL = options.maintainer.email;

            // Generates the links line from the links definitions
            options.links = options.links.reduce(function (total, link) {
                return total += link.target + '       ' + link.source + '\n';
            }, '');

            // Generates the dirs line from the dirs definitions
            options.directories = options.directories.reduce(function (total, directory) {
                return total += directory + '\n';
            }, '');

            // Line pattern for the Makefile
            var mkFilePattern = '\tmkdir -p "$(DESTDIR)<%= dest %>" && cp -ap <%= follow_soft_links %> "<%= cwd %>/<%= filepath %>" "$(DESTDIR)<%= file.dest %>"\n';

            // Generates lines of the Makefile
            options.file_list = this.files
                                    .map(function (file) {
                                        // Remove inexisting et folders
                                        var src = file.src.filter(function (src) {
                                            return grunt.file.exists(src) &&
                                                grunt.file.isFile(src);
                                        });
                                        return {
                                            src: src,
                                            dest: file.dest
                                        };
                                    })
                                    // Generates a line and adds it
                                    .reduce(function (total, file) {
                                        return total += file.src.reduce(function (tot, src) {
                                            var opts = {
                                                data: {
                                                    follow_soft_links: options.follow_soft_links ? '' : '-P',
                                                    dest: file.dest.substr(0, file.dest.lastIndexOf('/')),
                                                    cwd: process.cwd(),
                                                    filepath: src,
                                                    file: file
                                                }
                                            };
                                            return tot += grunt.template.process(mkFilePattern, opts);
                                        }, '');
                                    }, '');

            // Get all the files from the packaging folder
            var copyOpts = grunt.file.expandMapping(options.custom_template, temp_directory, {
                cwd: __dirname
            }).filter(function (fileOrDir) {
                return grunt.file.isFile(fileOrDir.src[0]);
            });

            // Render a file
            function processFile (data) {
                data = grunt.template.process(data, { data: options });
                return Object.keys(options).reduce(function (total, key) {
                    return total.replace(new RegExp('\\$\\{\\s*' + key + '\\s*\\}', 'g'), options[key]);
                }, data);
            }

            // Renders all the files
            for (var i in copyOpts) {
                grunt.file.copy(copyOpts[i].src, copyOpts[i].dest, {
                    process: processFile
                });
            }

            // copy package lifecycle scripts
            var scripts = ['preinst', 'postinst', 'prerm', 'postrm'];

            for (var j in scripts) {
                if (options[scripts[j]]) {
                    var destination = path.join(controlDirectory, scripts[j]);
                    if (options[scripts[j]].src) {
                        grunt.verbose.writeln(scripts[j] + ' script found');
                        grunt.file.copy(options[scripts[j]].src, destination);
                    } else if (options[scripts[j]].contents) {
                        grunt.verbose.writeln('Creating ' + scripts[j]);
                        grunt.file.write(destination, options[scripts[j]].contents);
                    }
                }
            }

            // run packaging binaries (i.e. build process)
            grunt.verbose.writeln('Running \'debuild --no-tgz-check -sa -us -uc --lintian-opts --suppress-tags tar-errors-from-data,tar-errors-from-control,dir-or-file-in-var-www\'');
            if (!options.simulate) {
                if (grunt.file.exists('/usr/bin/debuild')) {
                    var cmd = DEBUILD_CMD.split(' ');
                    var debuild = spawn(cmd.shift(), cmd, {
                        cwd: temp_directory,
                        stdio: [ 'ignore', (grunt.option('verbose') ? process.stdout : 'ignore'), process.stderr ]
                    });
                    debuild.on('exit', function (code) {
                        if (code !== 0) {
                            var logFile = grunt.file.read(grunt.file.expand(options.package_location + '*.build'));
                            grunt.log.subhead('\nerror running debuild!!');
                            if (logFile.search('Unmet\\sbuild\\sdependencies\\:\\sdebhelper') !== -1) {
                                grunt.log.warn('debhelper dependency not found try running \'sudo apt-get install debhelper\'');
                            }
                            done(false);
                        } else {
                            grunt.log.ok('Created package: ' + grunt.file.expand(options.package_location + '*.deb'));
                            if (options.repository) {
                                grunt.verbose.writeln('Running \'dput ' + options.repository + ' ' + grunt.file.expand(options.package_location + '*.changes') + '\'');
                                fs.chmodSync('' + grunt.file.expand(options.package_location + '*.changes'), '744');
                                var dputArguments = [options.repository, grunt.file.expand(options.package_location + '*.changes')];
                                if (grunt.option('verbose')) {
                                    dputArguments.unshift('-d');
                                }
                                var dput = spawn('dput', dputArguments, {
                                    stdio: [ 'ignore', (grunt.option('verbose') ? process.stdout : 'ignore'), process.stderr ]
                                });
                                dput.on('exit', function (code) {
                                    if (code !== 0) {
                                        grunt.log.subhead('\nerror uploading package using dput!!');
                                    } else {
                                        grunt.log.ok('Uploaded package: ' + grunt.file.expand(options.package_location + '*.deb'));
                                    }
                                    done(true);
                                });
                            } else {
                                done(true);
                            }
                        }
                    });
                } else {
                    grunt.log.subhead('\n\'debuild\' executable not found!!');
                    grunt.log.warn('to install debuild try running \'sudo apt-get install devscripts\'');
                    return done(false);
                }
            } else {
                return done(true);
            }
        }
    );
};
